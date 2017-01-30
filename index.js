module.exports = Slocket

var rimraf = require('rimraf')
var assert = require('assert')
var EE = require('events')
var net = require('net')
var fs = require('fs')
var path = require('path')
var onExit = require('signal-exit')
var locks = Object.create(null)
var ID = 0

/* istanbul ignore if */
if (typeof Promise === undefined)
  Promise = require('bluebird')

var util = require('util')
util.inherits(Slocket, EE)

var debug = function () {}

/* istanbul ignore if */
if (/\bslocket\b/i.test(process.env.NODE_DEBUG || '')) {
  debug = function () {
    var msg = util.format.apply(util, arguments)
    var n = path.basename(this.name)
    var p = 'SLOCKET:' + process.pid + ':' + n + ':' + this.id + ' '
    msg = p + msg.trimRight().split('\n').join('\n' + p)
    console.error(msg)
  }
}

function Slocket (name, cb) {
  if (!(this instanceof Slocket))
    return new Slocket(name, cb)

  this.id = ID++
  this.name = path.resolve(name)
  if (cb)
    this.cb = cb
  this.server = null
  this.connection = null
  this.watcher = null
  this.has = false
  this.had = false
  this.connectionQueue = []
  this.currentClient = null

  this.promise = new Promise(function (resolve, reject) {
    this.resolve = resolve
    this.reject = reject
  }.bind(this))
  this.then = this.promise.then.bind(this.promise)
  this.catch = this.promise.catch.bind(this.promise)

  this.acquire()
}

Slocket.prototype.debug = debug

Slocket.prototype.cb = function () {}

Slocket.prototype.acquire = function () {
  this.debug('acquire')
  this.unwatch()
  this.disconnect()
  this.server = net.createServer(this.onServerConnection.bind(this))
  this.server.once('error', this.onServerError.bind(this))
  this.server.listen(this.name, this.onServerListen.bind(this))
  this.server.on('close', this.onServerClose.bind(this))
}

Slocket.prototype.onAcquire = function () {
  this.debug('onAcquire')
  this.unwatch()
  assert.equal(this.has, false)
  this.has = true
  this.had = true
  this.emit('acquire')
  this.cb(null, this)
  // Promises are sometimes a little clever
  // when you resolve(<Promise>), it hooks onto the .then method
  // of the promise it's resolving to.  To avoid never actually
  // resolving, we wrap to hide the then/catch methods.
  this.resolve(Object.create(this, {
    then: { value: undefined },
    catch: { value: undefined },
    resolve: { value: undefined },
    reject: { value: undefined },
    release: { value: this.release.bind(this) }
  }))
}

Slocket.prototype.onServerListen = function () {
  this.debug('onServerListen', this.server.listening)
  this.emit('serverListen')
  process.nextTick(function onServerListenNT () {
    this.debug('onServerListenNT', this.server.listening)
    this.on('serverClose', onExit(this.onProcessExit.bind(this)))
    this.onAcquire()
  }.bind(this))
}

Slocket.prototype.onProcessExit = function () {
  this.debug('onProcessExit')
  if (this.has === true)
    this.release(true)
}

Slocket.prototype.onServerConnection = function (c) {
  this.debug('onServerConnection')
  this.emit('serverConnection', c)
  c.on('close', this.onServerConnectionClose.bind(this, c))
  if (this.currentClient || this.has)
    this.connectionQueue.push(c)
  else
    this.delegate(c)
}

Slocket.prototype.onServerConnectionClose = function (c) {
  this.debug('onServerConnectionClose', this.has)
  this.emit('serverConnectionClose', c)
  if (this.currentClient === c) {
    this.currentClient = null
    this.release()
  }

  var i = this.connectionQueue.indexOf(c)
  if (i !== -1)
    this.connectionQueue.splice(i, 1)
}

Slocket.prototype.delegate = function (c) {
  this.debug('delegate')
  assert.equal(this.has, false)
  this.debug('delegate new client')
  this.currentClient = c
  c.write('OK')
}

Slocket.prototype.type = function () {
  return !this.has ? 'none'
    : this.server && this.server.listening ? 'server'
    : this.connection ? 'connection'
    : 'wtf'
}

Slocket.prototype.release = function (sync) {
  this.debug('release has=%j sync=%j', this.has, sync)
  this.has = false
  this.connectionRelease(sync)
  this.serverRelease(sync)
}

Slocket.prototype.serverRelease = function (sync) {
  if (!this.server)
    return

  this.debug('serverRelease %j', sync, this.connectionQueue.length)
  this.server.unref()
  if (this.connectionQueue.length)
    this.delegate(this.connectionQueue.shift())
  else
    this.server.close()
}

Slocket.prototype.onServerClose = function () {
  this.debug('onServerClose')
  this.emit('serverClose')
  this.server = null
}

Slocket.prototype.onServerError = function (er) {
  this.debug('onServerError', er.message)
  this.emit('serverError', er)
  // XXX just in the off chance this happens later, kill any connections
  // and destroy the server
  if (this.server)
    this.server.close()
  this.server = null
  switch (er.code) {
    case 'ENOTSOCK':
      return this.watch()
    case 'EADDRINUSE':
    case 'EEXIST':
      return this.connect()
    default:
      er.slocket = 'server'
      this.onError(er)
  }
}

Slocket.prototype.onError = function (er) {
  this.debug('onError', er.message)
  this.cb(er, this)
  this.reject(er)
}

Slocket.prototype.connect = function () {
  this.debug('connect')
  this.connection = net.createConnection(this.name)
  this.connection.slocketBuffer = ''
  this.connection.setEncoding('utf8')
  this.connection.slocketConnected = false
  this.connection.on('connect', this.onConnect.bind(this))
  this.connection.on('error', this.onConnectionError.bind(this))
  this.connection.on('data', this.onConnectionData.bind(this))
}

Slocket.prototype.onConnectionData = function (chunk) {
  this.debug('onConnectionData %s', chunk, this.connection.slocketBuffer)
  this.emit('connectionData', chunk)
  this.connection.slocketBuffer += chunk

  if (this.connection.slocketBuffer === 'OK')
    this.onAcquire()

  if (this.connection.slocketBuffer.length > 2)
    this.connection.destroy()
}

Slocket.prototype.onConnectionError = function (er) {
  this.debug('onConnectionError', er.message)
  this.emit('connectionError', er)
  if (this.has)
    return this.onError(er)
  this.connection = null
  switch (er.code) {
    case 'ENOENT':
      // socket was there, but now is gone!
      return this.acquire()
    case 'ECONNREFUSED':
      // socket there, but not listening
      // watch for changes, in case it's that it's not a socket
      // if that fails, eg for "unknown system error", then just retry
      try {
        return this.watch()
      } catch (er) {
        return this.acquire()
      }
    default:
      er.slocket = 'connection'
      this.onError(er)
  }
}

Slocket.prototype.onConnect = function () {
  this.debug('onConnect')
  this.emit('connect')
  this.connection.slocketConnected = true
  this.connection.on('close', this.onConnectionClose.bind(this))
}

Slocket.prototype.onConnectionClose = function () {
  this.debug('onConnectionClose')
  this.emit('connectionClose')
  this.connection.slocketConnected = false
  if (!this.had)
    this.acquire()
}

Slocket.prototype.connectionRelease = function (sync) {
  if (!this.connection)
    return

  this.debug('connectionRelease', sync)

  if (this.connection.slocketConnected)
    this.connection.destroy()
  else if (sync)
    rimraf.sync(this.name)
  else
    rimraf(this.name, function () {})
}

Slocket.prototype.disconnect = function () {
  this.debug('disconnect')
  if (this.connection)
    this.connection.destroy()
  this.connection = null
}

Slocket.prototype.watch = function () {
  this.debug('watch')
  this.watcher = fs.watch(this.name, { persistent: false })
  this.watcher.on('change', this.acquire.bind(this))
  this.watch.on('error', this.acquire.bind(this))
}

Slocket.prototype.unwatch = function () {
  this.debug('unwatch')
  if (this.watcher)
    this.watcher.close()
  this.watcher = null
}

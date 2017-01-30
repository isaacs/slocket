# slocket

A locking socket alternative to file-system mutex locks

## Algorithm

```
to ACQUIRE(lockname)
- create server, listen on lockname
  - if enotsock, WATCH(lockname)
  - if eaddrinuse,
    - CONNECT(lockname)
  - unref server
  - lock has been acquired via server
  ! on connection, place sockets in queue

to RELEASE(lockname)
- if acquired via connection
  - if connected, disconnect
  - else, unlink lockname
- if acquired via server
  - send "OK" to front-most connection
    - when connection disconnects, RELEASE(lockname)
- if acquired via filename
  - unlink file

to CONNECT(lockname)
- net.connect(lockname)
  - if econnrefused (socket, but not listening!)
    could be that a server process crashed, leaving a dangling
    connection that thinks it has the lock.
    - WATCH(lockname)
  - if enoent or on socket termination, ACQUIRE(lockname)
  - when server says "OK",
    - lock has been acquired via connection
    - on connection disconnect, on release, unlink socket

to WATCH(lockname)
- fs.watch(lockname)
- on change, ACQUIRE(lockname)
```

## USAGE

```js
var slocket = require('slocket')

// Only one of these can run in this filesystem space,
// even if there are many processes running at once
function someMutexedThing (cb) {
  slocket('/path/to/my-lock-name', function (er, lock) {
    if (er) throw er
    // lock acquired
    // do your thing here
    // and then...
    lock.release()
  })
}
```

A slocket is like a Promise, so this works:

```js
slocket('/path/to/filename.lock').then(lock => {
  // do your stuff in this space
  lock.release()
}).catch(er => {
  // a lock could not be acquired
})
```

If you want to use async/await, you can do this, which is nice:

```js
async function fooSingleFile (args) {
  var lock = await slocket('foo')

  // now I have an exclusive lock on the fooness!

  await otherAsyncThingie(args)

  // all done, release the mutex
  lock.release()
}
```

var lock = require('../..')(process.argv[2])
lock.then(function () {
  console.log("1")
})
setTimeout(function() {}, 10000)
process.on("SIGHUP", lock.release)

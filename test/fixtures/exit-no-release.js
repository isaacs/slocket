var lock = require('../..')(process.argv[2])
lock.then(function () {
  console.log("1")
})
var t = setTimeout(function() {}, 10000)

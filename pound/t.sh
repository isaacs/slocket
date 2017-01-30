#!/bin/bash

cd $(dirname $0)
killall -SIGKILL node &>/dev/null
rm -f output.txt slocket-testing*

N=100
M=10
MS=0

runParallel () {
  rm -f slocket-testing*
  echo 'parallel'
  echo 'parallel' >&2
  let i=0
  while [ $i -lt $N ]; do
    node t.js $MS $M parallel &
    let i++
  done
  wait
}

runSerial () {
  rm -f slocket-testing*
  echo 'serial'
  echo 'serial' >&2
  let i=0
  while [ $i -lt $N ]; do
    node t.js $MS $M &
    let i++
  done
  wait
}

lfParallel () {
  rm -f slocket-testing*
  echo 'lf-parallel'
  echo 'lf-parallel' >&2
  let i=0
  while [ $i -lt $N ]; do
    node lf.js $MS $M parallel &
    let i++
  done
  wait
}

lfSerial () {
  rm -f slocket-testing*
  echo 'lf-serial'
  echo 'lf-serial' >&2
  let i=0
  while [ $i -lt $N ]; do
    node lf.js $MS $M &
    let i++
  done
  wait
}

time runParallel  >> output.txt
time runSerial  >> output.txt
time lfParallel  >> output.txt
time lfSerial  >> output.txt

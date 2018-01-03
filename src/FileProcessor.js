import { Promise } from 'es6-promise'
import SparkMD5 from 'spark-md5'

class FileProcessor {
  constructor (file, chunkSize) {
    this.paused = false
    this.file = file
    this.chunkSize = chunkSize
    this.unpauseHandlers = []
  }

  async run (fn, startIndex = 0, endIndex) {
    const { file, chunkSize } = this
    const totalChunks = Math.ceil(file.size / chunkSize)
    const singleChunk = totalChunks === 1
    let spark = new SparkMD5.ArrayBuffer()

    console.log('Starting run on file:')
    console.log(` - Total chunks: ${totalChunks}`)
    console.log(` - Start index: ${startIndex}`)
    console.log(` - End index: ${endIndex || totalChunks}`)

    const processIndex = async (index) => {
      if (index === totalChunks || index === endIndex) {
        console.log('File process complete')
        return
      }
      if (this.paused) {
        await waitForUnpause()
      }

      const start = index * chunkSize
      const section = file.slice(start, start + chunkSize)
      console.time('retrieve-chunk')
      const chunk = await getData(file, section)
      console.timeEnd('retrieve-chunk')
      console.time('checksum-calc')
      const checksum = getChecksum(spark, chunk)
      console.timeEnd('checksum-calc')
      console.time('upload-chunk')
      const shouldContinue = await fn(checksum, index, chunk, singleChunk)
      console.timeEnd('upload-chunk')

      if (shouldContinue !== false) {
        await processIndex(index + 1)
      }
    }

    const waitForUnpause = () => {
      return new Promise((resolve) => {
        this.unpauseHandlers.push(resolve)
      })
    }

    await processIndex(startIndex)
  }

  pause () {
    this.paused = true
  }

  unpause () {
    this.paused = false
    this.unpauseHandlers.forEach((fn) => fn())
    this.unpauseHandlers = []
  }
}

// function calcChecksum() {
//     return SparkMD5.hash(arguments.reduce((acc, val) => {
//         (!acc || (acc = ''));
//         acc += val.toString();
//         return acc;
//     }, ''));
// }

function getChecksum (spark, chunk) {
  spark.append(chunk)
  const checksum = spark.end()
  return checksum
}

async function getData (file, blob) {
  return new Promise((resolve, reject) => {
    let reader = new window.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(blob)
  })
}

export default FileProcessor

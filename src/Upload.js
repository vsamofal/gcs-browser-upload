import FileMeta from './FileMeta'
import FileProcessor from './FileProcessor'
import {
  DifferentChunkError,
  FileAlreadyUploadedError,
  UrlNotFoundError,
  UploadFailedError,
  UnknownResponseError,
  MissingOptionsError,
  UploadIncompleteError,
  InvalidChunkSizeError,
  UploadAlreadyFinishedError
} from './errors'
import * as errors from './errors'

const MIN_CHUNK_SIZE = 262144

export default class Upload {
  static errors = errors;

  constructor (args, allowSmallChunks) {
    var opts = {
      chunkSize: MIN_CHUNK_SIZE,
      storage: window.localStorage,
      contentType: 'text/plain',
      onChunkUpload: () => {},
      onUploadProgress: () => {},
      id: null,
      url: null,
      file: null,
      ...args
    }

    if ((opts.chunkSize % MIN_CHUNK_SIZE !== 0 || opts.chunkSize === 0) && !allowSmallChunks) {
      throw new InvalidChunkSizeError(opts.chunkSize)
    }

    if (!opts.id || !opts.url || !opts.file) {
      throw new MissingOptionsError()
    }

    console.log('Creating new upload instance:')
    console.log(` - Url: ${opts.url}`)
    console.log(` - Id: ${opts.id}`)
    console.log(` - File size: ${opts.file.size}`)
    console.log(` - Chunk size: ${opts.chunkSize}`)

    this.opts = opts
    this.meta = new FileMeta(opts.id, opts.file.size, opts.chunkSize, opts.storage)
    this.processor = new FileProcessor(opts.file, opts.chunkSize)
  }

  async start () {
    const { meta, processor, opts, finished } = this
    const _onUploadProgress = (c, total, totalChunksCount, index) => {
      return (event) => {
          const currentChunkProgress = Math.round(event.loaded / total * 100 / (index + 1));
          const totalFileProgress = Math.round(index / totalChunksCount * 100);
          const progress = currentChunkProgress + totalFileProgress;
          c(progress > 100 ? 100 : progress)
      }
    }

    const resumeUpload = async () => {
      const localResumeIndex = meta.getResumeIndex()
      const remoteResumeIndex = await getRemoteResumeIndex()

      const resumeIndex = Math.min(localResumeIndex, remoteResumeIndex)
      console.log(`Validating chunks up to index ${resumeIndex}`)
      console.log(` - Remote index: ${remoteResumeIndex}`)
      console.log(` - Local index: ${localResumeIndex}`)

      try {
        await processor.run(validateChunk, 0, resumeIndex)
      } catch (e) {
        console.log('Validation failed, starting from scratch')
        console.log(` - Failed chunk index: ${e.chunkIndex}`)
        console.log(` - Old checksum: ${e.originalChecksum}`)
        console.log(` - New checksum: ${e.newChecksum}`)

        await processor.run(uploadChunk)
        return
      }

      console.log('Validation passed, resuming upload')
      await processor.run(uploadChunk, resumeIndex)
    }

    const uploadChunk = async (checksum, index, chunk, singleChunk) => {
      const total = opts.file.size
      const start = index * opts.chunkSize
      const end = index * opts.chunkSize + chunk.byteLength - 1
      const totalChunksCount = Math.ceil(total / opts.chunkSize)

      const headers = {
        'Content-Type': opts.contentType
      }
      if (!singleChunk) {
        headers['Content-Range'] = `bytes ${start}-${end}/${total}`
      }

      console.log(`Uploading chunk ${index}:`)
      console.log(` - Chunk length: ${chunk.byteLength}`)
      console.log(` - Start: ${start}`)
      console.log(` - End: ${end}`)

      const onUploadProgress = _onUploadProgress(opts.onUploadProgress, total, totalChunksCount, index);
      const res = await safePut(opts.url, chunk, { headers, onUploadProgress })
      checkResponseStatus(res, opts, [200, 201, 308])
      console.log(`Chunk upload succeeded, adding checksum ${checksum}`)
      meta.addChecksum(index, checksum)

      opts.onChunkUpload({
        totalBytes: total,
        uploadedBytes: end + 1,
        chunkIndex: index,
        chunkLength: chunk.byteLength
      })
    }

    const validateChunk = async (newChecksum, index) => {
      const originalChecksum = meta.getChecksum(index)
      const isChunkValid = originalChecksum === newChecksum
      if (!isChunkValid) {
        meta.reset()
        throw new DifferentChunkError(index, originalChecksum, newChecksum)
      }
    }

    const getRemoteResumeIndex = async () => {
      const headers = {
        'Content-Range': `bytes */${opts.file.size}`
      }
      console.log('Retrieving upload status from GCS')
      const res = await safePut(opts.url, null, { headers })

      checkResponseStatus(res, opts, [308])
      //  according to documentation:
      //   If you received a 308 Resume Incomplete response, process the response's Range header, which specifies which
      //   bytes the server has received so far. The response will not have a Range header if no bytes have been received yet.
      //   https://cloud.google.com/storage/docs/json_api/v1/how-tos/resumable-upload
      if(!res.headers) {
        return 0;
      }
      const header = res.headers['range']
      console.log(`Received upload status from GCS: ${header}`)
      const range = header.match(/(\d+?)-(\d+?)$/)
      const bytesReceived = parseInt(range[2]) + 1
      return Math.floor(bytesReceived / opts.chunkSize)
    }

    if (finished) {
      throw new UploadAlreadyFinishedError()
    }

    if (meta.isResumable() && meta.getFileSize() === opts.file.size) {
      console.log('Upload might be resumable')
      await resumeUpload()
    } else {
      console.log('Upload not resumable, starting from scratch')
      await processor.run(uploadChunk)
    }
    console.log('Upload complete, resetting meta')
    meta.reset()
    this.finished = true
  }

  pause () {
    this.processor.pause()
    console.log('Upload paused')
  }

  unpause () {
    this.processor.unpause()
    console.log('Upload unpaused')
  }

  cancel () {
    this.processor.pause()
    this.meta.reset()
    console.log('Upload cancelled')
  }
}

function checkResponseStatus (res, opts, allowed = []) {
  const { status } = res
  if (allowed.indexOf(status) > -1) {
    return true
  }

  switch (status) {
    case 308:
      throw new UploadIncompleteError()

    case 201:
    case 200:
      throw new FileAlreadyUploadedError(opts.id, opts.url)

    case 404:
      throw new UrlNotFoundError(opts.url)

    case 500:
    case 502:
    case 503:
    case 504:
      throw new UploadFailedError(status)

    default:
      throw new UnknownResponseError(res)
  }
}

async function safePut(url, chunk, opts={}) {
    return new Promise((res, rej) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('put', url);
            for (let k in opts.headers||{}) {
                xhr.setRequestHeader(k, opts.headers[k]);
            }
            xhr.onload = e => {
              console.log(e)
              res(e.target);
            }
            xhr.onerror = rej;
            if (xhr.upload && opts.onUploadProgress) {
                xhr.upload.onprogress = opts.onUploadProgress;
            }

            xhr.send(chunk);
        } catch (e) {
            if (e instanceof Error) {
                throw e
            } else {
                return e
            }
        }
    });
}
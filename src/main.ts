import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import MP4Box from 'mp4box'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

// transmux video with ffmpeg.wasm and read info with mp4box
;(async () => {
  const webmVideoBlob = await fetch('/bunny.webm').then((res) => res.blob())
  // window.open(URL.createObjectURL(webmVideoBlob), '_blank')
  const mp4VideoBlob = await transmuxWebmToMp4(webmVideoBlob)
  // window.open(URL.createObjectURL(mp4VideoBlob), '_blank')
  const arrayBuffer = await mp4VideoBlob.arrayBuffer()
  const info = await readInfoWithMp4Box(arrayBuffer)
  console.log('info from ffmpeg transmuxed video', info)
})()

// mux video with mp4-muxer and attempt to ready info with mp4box
;(async () => {
  const framerate = 60
  const frameDuration = 1000 / framerate
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')!

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'vp9',
      width: canvas.width,
      height: canvas.height,
    },
    fastStart: 'in-memory',
  })

  let videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error(e),
  })
  videoEncoder.configure({
    codec: 'vp09.00.40.08',
    width: canvas.width,
    height: canvas.height,
    bitrate: 1e6,
    framerate,
  })

  let f = 0
  while (f * frameDuration < 10_000) {
    const r = f % 255
    ctx.fillStyle = `rgb(${r}, ${255}, ${255})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(f * frameDuration * 1000),
    })
    videoEncoder.encode(frame, {
      keyFrame: f % (framerate * 3) === 0,
    })
    f++
    frame.close()
  }

  await videoEncoder.flush()
  muxer.finalize()

  let { buffer } = muxer.target // Buffer contains final MP4 file

  // window.open(
  //   URL.createObjectURL(
  //     new Blob([buffer], {
  //       type: 'video/mp4',
  //     })
  //   ),
  //   '_blank'
  // )
  const info = await readInfoWithMp4Box(buffer)
  console.log('info from mp4-muxer muxed video', info)
})()

async function getFFmpeg(
  baseURL = new URL('/ffmpeg', new URL(import.meta.url).origin).toString()
) {
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  return ffmpeg
}

async function transmuxWebmToMp4(input: Blob | string) {
  const INPUT_FILE_NAME = 'input.webm'
  const OUTPUT_FILE_NAME = 'output.mp4'
  const ffmpeg = await getFFmpeg()
  await ffmpeg.writeFile(INPUT_FILE_NAME, await fetchFile(input))
  // transmux NOT transcode
  await ffmpeg.exec(['-i', INPUT_FILE_NAME, '-c', 'copy', OUTPUT_FILE_NAME])
  const data = await ffmpeg.readFile(OUTPUT_FILE_NAME)
  await ffmpeg.deleteFile(INPUT_FILE_NAME)
  await ffmpeg.deleteFile(OUTPUT_FILE_NAME)
  if (!(data instanceof Uint8Array)) {
    throw new Error('Output is not a Uint8Array')
  }
  return new Blob([data], {
    type: 'video/mp4',
  })
}

function readInfoWithMp4Box(arrayBuffer: ArrayBuffer) {
  return new Promise<MP4Box.MP4Info>((resolve) => {
    const mp4boxfile = MP4Box.createFile()
    mp4boxfile.onError = function (e) {
      console.error(e)
    }
    mp4boxfile.onReady = function (info) {
      resolve(info)
    }
    ;(arrayBuffer as any).fileStart = 0
    mp4boxfile.appendBuffer(arrayBuffer)
    mp4boxfile.flush()
  })
}

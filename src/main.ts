import { mat3, mat4 } from 'gl-matrix'
import { SFXObject } from './sfxobject'
import * as util from './util'

console.log('Hello, world!')

const canvas = <HTMLCanvasElement>document.getElementById('main-canvas')
const desiredWidth = canvas.width
const desiredHeight = canvas.height
canvas.setAttribute('style', `width: ${desiredWidth}px; height: ${desiredHeight}px`)
const devicePixelRatio = window.devicePixelRatio || 1
canvas.width = desiredWidth * devicePixelRatio
canvas.height = desiredHeight * devicePixelRatio

// Get GL context AFTER resizing canvas, otherwise the viewport is wrong.
const gl = <WebGL2RenderingContext>canvas.getContext('webgl')

// These are addresses of object header arrays. I don't know whether these are separate arrays or
// or one big array that is being interpreted wrongly.
//const SF1_OBJECT_LIST_ADDRESS = 0x2C15
//const SF1_OBJECT_LIST_ADDRESS = 0x34DF
//const SF1_OBJECT_LIST_ADDRESS = 0x38DB
const SF1_OBJECT_LIST_ADDRESS = 0x3B80
//const SF1_OBJECT_LIST_ADDRESS = 0x5898
const SF1_OBJECT_HEADER_LENGTH = 0x1C

class SFXViewer
{
    gl: WebGLRenderingContext
    rom: ArrayBuffer
    sfxObject: SFXObject
    modelMatrix: mat4 = mat4.create()

    constructor(gl: WebGLRenderingContext)
    {
        this.gl = gl
    }

    loadRom(rom: ArrayBuffer)
    {
        console.log(`Loading ROM...`)

        // Note: Many sources assume there is a 0x200-byte padding at the beginning of the ROM.
        // TODO: Detect and handle this padding.

        this.rom = rom

        // Big high poly Arwing
        //this.sfxObject = new SFXObject(rom, 0x66001, 0x66042)
        // Phantron transformation
        //this.sfxObject = new SFXObject(rom, 0x75916, 0x75F42)
        // Andross face morph
        //this.sfxObject = new SFXObject(rom, 0x7E29E, 0x7E886)
        // Andross sucking
        //this.sfxObject = new SFXObject(rom, 0x7EB81, 0x7F05B)
        // Andross evil face morph
        //this.sfxObject = new SFXObject(rom, 0x8E1FE, 0x8EA22)
        // Helicopter
        //this.sfxObject = new SFXObject(rom, 0x7B193, 0x7B215)
    }

    loadObject(headerAddress: number)
    {
        const gl = this.gl

        const dv = new DataView(this.rom)

        // The ROM is divided into banks of 0x8000 bytes each. These banks are mapped onto the SNES
        // bus with a fairly complex formula (LoROM). Fortunately, this field simply specifies the
        // ROM bank, so there is no need to worry about SNES memory mapping.
        const bank = dv.getUint8(headerAddress + 2)
        // ??? I don't know why we use "bank - 1" instead of just "bank". Possibly because bank "0"
        // marks a null object.
        if (bank != 0)
        {
            const verticesAddress = (0x8000 * (bank - 1)) + dv.getUint16(headerAddress, true)
            const facesAddress = (0x8000 * (bank - 1)) + dv.getUint16(headerAddress + 3, true)

            console.log(`Loading from verts address 0x${verticesAddress.toString(16)}; faces address 0x${facesAddress.toString(16)}`)
            this.sfxObject = new SFXObject(gl, this.rom, verticesAddress, facesAddress)
        }
        else
        {
            console.warn(`No object found at header address 0x${headerAddress.toString(16)}`)
            this.sfxObject = null
        }
    }

    setModelMatrix(modelMatrix: mat4)
    {
        this.modelMatrix = mat4.clone(modelMatrix)
    }

    render()
    {
        gl.clearColor(0.1, 0.2, 0.3, 1)
        gl.clearDepth(1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        if (this.sfxObject)
        {
            gl.enable(gl.DEPTH_TEST)
            gl.lineWidth(8.0)

            const viewMatrix = mat4.create()
            mat4.translate(viewMatrix, viewMatrix, [0., 0., -150])

            const projMatrix = mat4.create()
            mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
            
            const viewProjMatrix = util.mat4_mul(projMatrix, viewMatrix)

            this.sfxObject.render(this.modelMatrix, viewProjMatrix)
        }
    }
}

const INITIAL_MODEL_NUMBER = 76
var viewer: SFXViewer = null
var horzRotation: number = 0
var vertRotation: number = 0
var modelNumber: number = INITIAL_MODEL_NUMBER
var lastFrameTime: number = performance.now()

const fileInput = <HTMLInputElement>document.getElementById('file-input')
fileInput.onchange = function (event)
{
    const file = fileInput.files[0]
    console.log(`Loading ${file.name}...`)

    const reader = new FileReader()
    reader.onloadend = function (evt)
    {
        if (evt.target.readyState == FileReader.DONE)
        {
            horzRotation = 0
            vertRotation = 0
            modelNumber = INITIAL_MODEL_NUMBER
            lastFrameTime = performance.now()
            viewer = new SFXViewer(gl)
            viewer.loadRom(reader.result)
            render()
        }
    }

    reader.readAsArrayBuffer(file)
}

const modelNum = <HTMLInputElement>document.getElementById('model-num')
modelNum.onchange = function (ev)
{
    if (viewer)
    {
        modelNumber = modelNum.valueAsNumber
        horzRotation = 0
        vertRotation = 0
        lastFrameTime = performance.now()
        const headerAddress = SF1_OBJECT_LIST_ADDRESS + SF1_OBJECT_HEADER_LENGTH * modelNumber
        viewer.loadObject(headerAddress)
        render()
    }
}

function render()
{
    if (viewer)
    {
        var modelMatrix = util.mat4_mul(
            util.mat4_rotateX(vertRotation),
            util.mat4_rotateY(horzRotation)
        )
        // Invert Y and Z axes since SuperFX coordinate system is upside-down and reversed from WebGL.
        modelMatrix = util.mat4_mul(
            modelMatrix,
            util.mat4_scale(1, -1, -1)
        )
        viewer.setModelMatrix(modelMatrix)
        viewer.render()
    }
}

var isPointerDown = false
canvas.addEventListener('pointerdown', function (ev) {
    this.setPointerCapture(ev.pointerId)
    isPointerDown = true
})
canvas.addEventListener('pointerup', function (ev) {
    isPointerDown = false
})

canvas.addEventListener('pointermove', function (ev) {
    if (isPointerDown)
    {
        horzRotation += ev.movementX / 75 / Math.PI
        vertRotation += ev.movementY / 75 / Math.PI
        render()
    }
})

const FRAMES_PER_SECOND = 10
const FRAME_MILLIS = 1000 / FRAMES_PER_SECOND
const MAX_DELTA = 2000

function advance(delta_: number)
{
    if (viewer && viewer.sfxObject)
    {
        if (delta_ >= MAX_DELTA)
        {
            // Too much lag; resync frame timer
            lastFrameTime += delta_ - MAX_DELTA
        }

        var delta = util.clamp(delta_, 0, MAX_DELTA)
        while (delta >= FRAME_MILLIS)
        {
            delta -= FRAME_MILLIS
            lastFrameTime += FRAME_MILLIS
            viewer.sfxObject.loadFrame((viewer.sfxObject.curFrame + 1) % viewer.sfxObject.numFrames)
        }

        viewer.render()
    }
}

function onFrame(now: number)
{
    advance(now - lastFrameTime)

    window.requestAnimationFrame(onFrame)
}

onFrame(performance.now())
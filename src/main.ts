import { mat3, mat4, vec2, vec3, vec4 } from 'gl-matrix'
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

// Proportional-integral-derivative controller
class PIDController
{
    Kp: number = 0
    Ki: number = 0
    Kd: number = 0
    integral: number = 0
    previousError: number = 0

    constructor(Kp: number, Ki: number, Kd: number)
    {
        this.Kp = Kp
        this.Ki = Ki
        this.Kd = Kd
    }

    advance(delta: number, current: number, target: number): number
    {
        const e = target - current
        this.integral += e * delta
        const derivative = (e - this.previousError) / delta
        this.previousError = e // TODO: apply filtering to derivative and integral?

        return this.Kp * e + this.Ki * this.integral + this.Kd * derivative
    }
}

class SFXViewer
{
    gl: WebGLRenderingContext
    rom: ArrayBuffer
    sfxObject: SFXObject
    modelMatrix: mat4 = mat4.create()
    pendingDelta = 0 // pending delta in seconds. the simulation runs in discrete steps. this variable tracks the pending time after the last step.
    DELTA_STEP = 1 / 120 // size of delta step in seconds

    pitch: number = 0
    targetPitch: number = 0
    pitchVelocity: number = 0 // pitch velocity in radians per second
    pitchAcceleration: number = 0 // pitch acceleration in radians per second^2
    pitchPid: PIDController = new PIDController(15, 0, 7.5) // Numbers found through experimentation
    MAX_PITCH_ACCELERATION: number = Math.PI
    

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

    setTargetPitch(targetPitch: number)
    {
        this.targetPitch = targetPitch
    }

    advance(delta: number)
    {
        this.pendingDelta += delta / 1000
        while (this.pendingDelta >= this.DELTA_STEP)
        {
            this.pitchAcceleration = this.pitchPid.advance(this.DELTA_STEP, this.pitch, this.targetPitch)
            this.pitchAcceleration = util.clamp(this.pitchAcceleration, -this.MAX_PITCH_ACCELERATION, this.MAX_PITCH_ACCELERATION)

            this.pitchVelocity += this.pitchAcceleration * this.DELTA_STEP
            this.pitch += this.pitchVelocity * this.DELTA_STEP

            this.pendingDelta -= this.DELTA_STEP
        }
    }

    render()
    {
        if (this.sfxObject)
        {
            gl.enable(gl.DEPTH_TEST)
            gl.lineWidth(8.0)

            const viewMatrix = mat4.create()
            mat4.translate(viewMatrix, viewMatrix, [0., 0., -150])

            const projMatrix = mat4.create()
            mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
            
            const viewProjMatrix = util.mat4_mul(projMatrix, viewMatrix)

            const modelMatrix = mat4.clone(this.modelMatrix)
            mat4.rotateX(modelMatrix, modelMatrix, this.pitch)

            this.sfxObject.render(modelMatrix, viewProjMatrix)
        }
    }
}

interface Star
{
    point: vec3
    color: vec4
}

const STARFIELD_VERTEX_SHADER_SOURCE =
`
precision mediump float;

attribute vec3 aPosition;

uniform mat4 uModelMatrix;
uniform mat4 uViewProjMatrix;

varying vec3 vWorldPosition;

void main()
{
    vWorldPosition = (uModelMatrix * vec4(aPosition, 1.)).xyz;
    gl_Position = uViewProjMatrix * vec4(vWorldPosition, 1.);
    gl_PointSize = 4.;
}
`

const STARFIELD_FRAGMENT_SHADER_SOURCE =
`
precision mediump float;

varying vec3 vWorldPosition;

uniform vec3 uEye; // Currently unused
uniform vec4 uColor;

void main()
{
    gl_FragColor = uColor;
}
`

class StarfieldShader
{
    program: WebGLProgram
    aPosition: number
    uModelMatrix: WebGLUniformLocation
    uViewProjMatrix: WebGLUniformLocation
    uEye: WebGLUniformLocation
    uColor: WebGLUniformLocation

    constructor()
    {
        this.program = util.compileProgram(gl, STARFIELD_VERTEX_SHADER_SOURCE, STARFIELD_FRAGMENT_SHADER_SOURCE)

        this.aPosition = gl.getAttribLocation(this.program, 'aPosition')
        this.uModelMatrix = gl.getUniformLocation(this.program, 'uModelMatrix')
        this.uViewProjMatrix = gl.getUniformLocation(this.program, 'uViewProjMatrix')
        this.uEye = gl.getUniformLocation(this.program, 'uEye')
        this.uColor = gl.getUniformLocation(this.program, 'uColor')
    }
}

class Starfield
{
    shader: StarfieldShader = new StarfieldShader()
    stars: Star[] = []
    pendingDelta = 0 // pending delta in seconds. the simulation runs in discrete steps. this variable tracks the pending time after the last step.
    DELTA_STEP = 1 / 120 // size of delta step in seconds
    MAX_STARS = 1000
    vertexBuffer: WebGLBuffer = gl.createBuffer()

    advance(delta: number, heading: vec3)
    {
        this.pendingDelta += delta / 1000
        while (this.pendingDelta >= this.DELTA_STEP)
        {
            // Move existing stars
            for (let i = 0; i < this.stars.length; i++)
            {
                this.stars[i].point = util.vec3_scaleAndAdd(this.stars[i].point, heading, this.DELTA_STEP)
            }

            // Retire old stars
            for (let i = 0; i < this.stars.length;)
            {
                if (this.stars[i].point[2] > 1)
                {
                    this.stars.splice(i, 1)
                }
                else
                {
                    i++
                }
            }

            // Spawn new stars
            for (let i = 0; i < 4; i++)
            {
                if (this.stars.length >= this.MAX_STARS)
                    break

                if (Math.random() <= 0.1)
                {
                    this.stars.push({
                        point: vec3.fromValues(Math.random() * 2 - 1, Math.random() * 2 - 1, 0),
                        color: vec4.fromValues(1, 1, 1, 1)
                    })
                }
            }

            this.pendingDelta -= this.DELTA_STEP
        }
    }

    render()
    {
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, mat4.create())

        const viewMatrix = mat4.create()
        mat4.translate(viewMatrix, viewMatrix, [0., 0., -1])

        const projMatrix = mat4.create()
        mat4.perspective(projMatrix, 90, canvas.width / canvas.height, 0, 1)
        
        const viewProjMatrix = util.mat4_mul(projMatrix, viewMatrix)
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        gl.uniform3fv(this.shader.uEye, [0, 0, 0])
        gl.uniform4fv(this.shader.uColor, [1, 1, 1, 1])

        gl.disableVertexAttribArray(this.shader.aPosition)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
        for (let i = 0; i < this.stars.length; i++)
        {
            gl.vertexAttrib3fv(this.shader.aPosition, this.stars[i].point)
            gl.drawArrays(gl.POINTS, 0, 1)
        }
    }
}

const INITIAL_MODEL_NUMBER = 10
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

const starfield = new Starfield()

function render()
{
    gl.clearColor(0, 0, 0, 1)
    gl.clearDepth(1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    starfield.render()

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

const pressedKeys = {}
window.addEventListener('keydown', function (ev) {
    pressedKeys[ev.keyCode] = true
})
window.addEventListener('keyup', function (ev) {
    pressedKeys[ev.keyCode] = false
})

const pidCanvas = <HTMLCanvasElement>document.getElementById('pid-canvas')
const pid2d = pidCanvas.getContext('2d')
const pidkp = <HTMLInputElement>document.getElementById('pid-kp')
const pidki = <HTMLInputElement>document.getElementById('pid-ki')
const pidkd = <HTMLInputElement>document.getElementById('pid-kd')

function drawPid()
{
    pidCanvas.width = pidCanvas.width // Reset the canvas and all parameters

    const Kp = pidkp.valueAsNumber
    const Ki = pidki.valueAsNumber
    const Kd = pidkd.valueAsNumber

    const PID_SAMPLES = 60 * 4
    const PID_DELTA = 1 / 60
    pid2d.save()
    pid2d.scale(pidCanvas.width / PID_SAMPLES, pidCanvas.height / -10)
    pid2d.translate(0, -5)

    const MAX_YAW_ACCELERATION = Math.PI
    const targetYaw = Math.PI / 3
    var currentYaw = 0
    var currentYawVelocity = 0
    var currentYawAcceleration = 0
    var yawErrorIntegral = 0
    var yawPreviousError = 0

    // Draw target
    pid2d.strokeStyle = 'red'
    // TODO: draw in red. strokeStyle is clobbered later.
    pid2d.moveTo(0, targetYaw)
    pid2d.lineTo(PID_SAMPLES, targetYaw)

    // Draw yaw graph
    pid2d.strokeStyle = 'black'
    pid2d.moveTo(0, 0)
    for (let i = 0; i < PID_SAMPLES; i++)
    {
        // Control the ship with a crude PID controller
        // TODO: step by fixed deltas; be more robust in varying framerates
        const e = targetYaw - currentYaw
        yawErrorIntegral += e * PID_DELTA
        const derivative = (e - yawPreviousError) / PID_DELTA

        currentYawAcceleration = Kp * e + Ki * yawErrorIntegral + Kd * derivative
        currentYawAcceleration = util.clamp(currentYawAcceleration, -MAX_YAW_ACCELERATION, MAX_YAW_ACCELERATION)

        yawPreviousError = e

        currentYawVelocity += currentYawAcceleration * PID_DELTA
        currentYaw += currentYawVelocity * PID_DELTA

        pid2d.lineTo(i, currentYaw)
    }
    pid2d.restore()
    pid2d.stroke()
}

const FRAMES_PER_SECOND = 10
const FRAME_MILLIS = 1000 / FRAMES_PER_SECOND
const MAX_DELTA = 2000
var pendingAnimDelta = 0

function advance(delta: number)
{
    if (delta >= MAX_DELTA)
    {
        // Too much lag; resync frame timer
        lastFrameTime += delta - MAX_DELTA
        delta = MAX_DELTA
    }

    if (viewer)
    {
        const heading = vec3.fromValues(0, 0, 1)
        vec3.rotateX(heading, heading, [0, 0, 0], viewer.pitch)
        starfield.advance(delta, heading)
    }
    else
    {
        starfield.advance(delta, vec3.fromValues(0, 0, 1))
    }

    if (viewer && viewer.sfxObject)
    {
        pendingAnimDelta += delta
        while (pendingAnimDelta >= FRAME_MILLIS)
        {
            viewer.sfxObject.loadFrame((viewer.sfxObject.curFrame + 1) % viewer.sfxObject.numFrames)
            pendingAnimDelta -= FRAME_MILLIS
        }

        var vertDir = 0
        var horzDir = 0
        if (pressedKeys['W'.charCodeAt(0)])
            vertDir -= 1
        if (pressedKeys['S'.charCodeAt(0)])
            vertDir += 1
        if (pressedKeys['A'.charCodeAt(0)])
            horzDir -= 1
        if (pressedKeys['D'.charCodeAt(0)])
            horzDir += 1

        viewer.setTargetPitch(Math.PI / 3 * vertDir)
        viewer.advance(delta)
    }

    lastFrameTime += delta
}

function onFrame(now: number)
{
    advance(now - lastFrameTime)
    render()
    drawPid()

    window.requestAnimationFrame(onFrame)
}

onFrame(performance.now())
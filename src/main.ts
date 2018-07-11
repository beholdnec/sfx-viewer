console.log('Hello, world!')

function loadRom(rom: Uint8Array)
{
    console.log(`Loading ROM...`)
}

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
            loadRom(new Uint8Array(reader.result))
        }
    }

    reader.readAsArrayBuffer(file)
}
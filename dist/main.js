console.log('Hello, world!');
function loadRom(rom) {
    console.log("Loading ROM...");
}
var fileInput = document.getElementById('file-input');
fileInput.onchange = function (event) {
    var file = fileInput.files[0];
    console.log("Loading " + file.name + "...");
    var reader = new FileReader();
    reader.onloadend = function (evt) {
        if (evt.target.readyState == FileReader.DONE) {
            loadRom(new Uint8Array(reader.result));
        }
    };
    reader.readAsArrayBuffer(file);
};

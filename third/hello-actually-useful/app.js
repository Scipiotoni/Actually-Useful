var lines = ['You are doing great.', 'Ship it.', 'That looks sharp.'];
var button = document.getElementById('cheer');
if (button) {
  button.addEventListener('click', function () {
    var pick = lines[Math.floor(Math.random() * lines.length)];
    document.getElementById('out').textContent = pick;
    console.log('cheered:', pick);
  });
}
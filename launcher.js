// launcher.js
import { spawn } from 'child_process';
import path from 'path';
import process from 'process';

const indexFile = path.resolve('./index.js');

function startApp() {
  const child = spawn(
    'npx',
    ['nodemon', '--watch', '.', '--ignore', 'cookies.json', '--exitcrash', "-I", indexFile],
    {
      stdio: 'inherit', // so Blessed can use the terminal
      shell: true
    }
  );

  child.on('exit', (code) => {
    if (code !== 0) {
      console.log(`App crashed with code ${code}. Restarting...`);
      startApp(); // restart automatically
    }
  });
}

startApp();

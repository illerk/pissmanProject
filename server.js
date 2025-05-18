import fs from 'fs';
import https from 'https';
import { WebSocketServer } from 'ws';

const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/immersivethingsforsierra.ru/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/immersivethingsforsierra.ru/privkey.pem')
});

const wss = new WebSocketServer({ server });

let clients = [];

wss.on('connection', function connection(ws) {
  clients.push(ws);
  ws.on('message', function incoming(message) {
    clients.forEach(client => {
      if (client !== ws && client.readyState === ws.OPEN) {
        client.send(message);
      }
    });
  });
  ws.on('close', () => {
    clients = clients.filter(c => c !== ws);
  });
});

server.listen(3000, () => {
  console.log('WSS server running on port 3000');
});

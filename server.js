// server.js
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 3000 });

let clients = [];

wss.on('connection', function connection(ws) {
  clients.push(ws);
  ws.on('message', function incoming(message) {
    // Отправить всем, кроме отправителя (или только "оператору")
    clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
  ws.on('close', () => {
    clients = clients.filter(c => c !== ws);
  });
});

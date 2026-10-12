// The MCP server: JSON-RPC 2.0 messages, one per line, on standard input and output. Written by
// hand, with no dependencies, so that everything this program does can be read in a few files.
// It only talks over this pipe to the agent that started it; it opens no network port.
import readline from 'node:readline';
import { VERSION } from './config.js';
import { INSTRUCTIONS, TOOLS, callTool } from './tools.js';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export function serve() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = 0;
  let closed = false;
  const maybeExit = () => closed && pending === 0 && process.exit(0);

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (msg.id === undefined || msg.id === null) return; // a notification: nothing to answer
    const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result });
    pending++;
    try {
      switch (msg.method) {
        case 'initialize':
          reply({
            protocolVersion: PROTOCOLS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : PROTOCOLS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'problemhive-sandbox', version: VERSION },
            instructions: INSTRUCTIONS,
          });
          break;
        case 'ping':
          reply({});
          break;
        case 'tools/list':
          reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) });
          break;
        case 'tools/call': {
          const r = await callTool(msg.params?.name, msg.params?.arguments);
          reply({ content: [{ type: 'text', text: r.text }], isError: r.isError });
          break;
        }
        default:
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e?.message ?? e) } });
    } finally {
      pending--;
      maybeExit();
    }
  });
  rl.on('close', () => {
    closed = true;
    maybeExit();
  });
}

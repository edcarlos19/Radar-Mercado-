const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Auto-ping a cada 14 minutos
setInterval(() => {
  try {
    const url = new URL(RENDER_URL);
    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.request({ hostname: url.hostname, port: url.port || 443, path: '/ping', method: 'GET' }, () => {});
    req.on('error', () => {});
    req.end();
  } catch(e) {}
}, 14 * 60 * 1000);

function callAnthropic(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          const text = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          resolve(text);
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(55000, () => { req.destroy(); reject(new Error('Tempo limite. Tente novamente.')); });
    req.write(payload);
    req.end();
  });
}

// Gera cada seção separadamente para evitar JSON inválido
async function gerarSecao(nicho, dateStr, tipo) {
  const prompts = {
    novidades: `Você é analista sênior de mercado. Data: ${dateStr}. Escreva em português brasileiro as PRINCIPAIS NOVIDADES E NOTÍCIAS recentes do mercado de "${nicho}". Inclua lançamentos, regulação, fusões e aquisições. Use parágrafos e listas HTML (<p>, <ul><li>). Inclua um <div class='highlight'> com um dado de impacto. Retorne APENAS o HTML, sem explicações, sem markdown.`,
    concorrencia: `Você é analista sênior de mercado. Data: ${dateStr}. Escreva em português brasileiro os MOVIMENTOS DA CONCORRÊNCIA no mercado de "${nicho}". Cite empresas específicas em <strong>. Use <p> e <ul><li>. Retorne APENAS o HTML, sem explicações, sem markdown.`,
    oportunidades: `Você é consultor estratégico. Data: ${dateStr}. Escreva em português brasileiro as OPORTUNIDADES DE MERCADO em "${nicho}". Seja propositivo e prático. Use <p>, <ul><li> e um <div class='highlight'>. Retorne APENAS o HTML, sem explicações, sem markdown.`,
    tendencias: `Você é especialista em tendências. Data: ${dateStr}. Escreva em português brasileiro as TENDÊNCIAS 2025-2030 do mercado de "${nicho}". Inclua dados prospectivos. Use <p> e <ul><li>. Retorne APENAS o HTML, sem explicações, sem markdown.`
  };
  return await callAnthropic(prompts[tipo]);
}

const server = http.createServer(async (req, res) => {

  if (req.url === '/ping') { res.writeHead(200); return res.end('pong'); }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/radar') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        const { nicho, dateStr } = JSON.parse(body);
        console.log(`Gerando radar: ${nicho}`);

        // Gera as 4 seções em paralelo
        const [novidades, concorrencia, oportunidades, tendencias] = await Promise.all([
          gerarSecao(nicho, dateStr, 'novidades'),
          gerarSecao(nicho, dateStr, 'concorrencia'),
          gerarSecao(nicho, dateStr, 'oportunidades'),
          gerarSecao(nicho, dateStr, 'tendencias')
        ]);

        console.log('Sucesso!');
        // Serialize safely
        res.end(JSON.stringify({
          success: true,
          data: { novidades, concorrencia, oportunidades, tendencias }
        }));
      } catch(e) {
        console.error('Erro:', e.message);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.timeout = 60000;
server.listen(PORT, () => console.log(`Radar Mercado rodando na porta ${PORT} | auto-ping ativo`));

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const DB_FILE = path.join(__dirname, 'assinantes.json');

// ── Banco de assinantes (arquivo JSON) ──
function lerAssinantes() {
  try {
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { return []; }
}
function salvarAssinantes(lista) {
  fs.writeFileSync(DB_FILE, JSON.stringify(lista, null, 2));
}
function adicionarAssinante(nome, email, setor) {
  const lista = lerAssinantes();
  const existe = lista.find(a => a.email === email);
  if (existe) { existe.setor = setor; existe.nome = nome; }
  else lista.push({ nome, email, setor, ativo: true, cadastro: new Date().toISOString() });
  salvarAssinantes(lista);
}

// ── Auto-ping a cada 14 minutos ──
setInterval(() => {
  try {
    const url = new URL(RENDER_URL);
    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.request({ hostname: url.hostname, port: url.port || 443, path: '/ping', method: 'GET' }, () => {});
    req.on('error', () => {});
    req.end();
  } catch(e) {}
}, 14 * 60 * 1000);

// ── Agendador — toda segunda-feira às 7h ──
function agendarEnvioSemanal() {
  function proximaSegunda7h() {
    const agora = new Date();
    const diasParaSegunda = (1 - agora.getDay() + 7) % 7 || 7;
    const proxima = new Date(agora);
    proxima.setDate(agora.getDate() + diasParaSegunda);
    proxima.setHours(7, 0, 0, 0);
    return proxima - agora;
  }
  function agendar() {
    const ms = proximaSegunda7h();
    console.log(`Próximo envio em ${Math.round(ms/3600000)}h`);
    setTimeout(async () => {
      await enviarParaTodos();
      agendar(); // reagenda para próxima semana
    }, ms);
  }
  agendar();
}

// ── Chama a API da Anthropic ──
function callAnthropic(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
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
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) { reject(new Error(p.error.message)); return; }
          resolve((p.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(55000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── Gera cada seção ──
async function gerarSecao(nicho, dateStr, tipo) {
  const prompts = {
    novidades: `Analista de mercado. Data: ${dateStr}. Mercado: "${nicho}". Retorne JSON sem markdown:
{"html":"<p>3 novidades recentes.</p><ul><li>item</li><li>item</li><li>item</li></ul><div class='highlight'>1 dado impacto</div><div class='fontes'><strong>Fontes:</strong><ul><li><a href='URL_REAL'>Fonte</a></li></ul></div>","graficos":[{"titulo":"Crescimento do Mercado","tipo":"bar","labels":["2021","2022","2023","2024","2025"],"dados":[0,0,0,0,0],"cor":"#1a5f7a"},{"titulo":"Evolução de Receita (R$ bi)","tipo":"line","labels":["2021","2022","2023","2024","2025"],"dados":[0,0,0,0,0],"cor":"#c9a84c"}]}
Substitua os zeros por dados reais do setor.`,
    concorrencia: `Analista de mercado. Data: ${dateStr}. Mercado: "${nicho}". Retorne JSON sem markdown:
{"html":"<p>Movimentos dos principais players.</p><ul><li><strong>Empresa</strong>: ação</li><li><strong>Empresa</strong>: ação</li><li><strong>Empresa</strong>: ação</li></ul><div class='fontes'><strong>Fontes:</strong><ul><li><a href='URL_REAL'>Fonte</a></li></ul></div>","graficos":[{"titulo":"Market Share (%)","tipo":"doughnut","labels":["P1","P2","P3","P4","Outros"],"dados":[0,0,0,0,0],"cor":"#0d1117"},{"titulo":"Crescimento por Player (%)","tipo":"bar","labels":["P1","P2","P3","P4"],"dados":[0,0,0,0],"cor":"#b5341a"}]}
Substitua os zeros e nomes por dados reais do setor.`,
    oportunidades: `Consultor estratégico. Data: ${dateStr}. Mercado: "${nicho}". Retorne JSON sem markdown:
{"html":"<p>3 oportunidades principais.</p><ul><li>Oportunidade 1</li><li>Oportunidade 2</li><li>Oportunidade 3</li></ul><div class='highlight'>Maior oportunidade</div><div class='fontes'><strong>Fontes:</strong><ul><li><a href='URL_REAL'>Fonte</a></li></ul></div>","graficos":[{"titulo":"Potencial por Segmento (R$ bi)","tipo":"bar","labels":["S1","S2","S3","S4"],"dados":[0,0,0,0],"cor":"#1a7a4a"},{"titulo":"Penetração por Região (%)","tipo":"doughnut","labels":["Sul","Sudeste","Centro-Oeste","Norte","Nordeste"],"dados":[0,0,0,0,0],"cor":"#c9a84c"}]}
Substitua os zeros e labels por dados reais do setor.`,
    tendencias: `Especialista em tendências. Data: ${dateStr}. Mercado: "${nicho}". Retorne JSON sem markdown:
{"html":"<p>3 tendências 2025-2030.</p><ul><li>Tendência 1</li><li>Tendência 2</li><li>Tendência 3</li></ul><div class='fontes'><strong>Fontes:</strong><ul><li><a href='URL_REAL'>Fonte</a></li></ul></div>","graficos":[{"titulo":"Projeção de Crescimento 2025-2030","tipo":"line","labels":["2025","2026","2027","2028","2029","2030"],"dados":[0,0,0,0,0,0],"cor":"#1a5f7a"},{"titulo":"Adoção de Tecnologia (%)","tipo":"bar","labels":["2025","2026","2027","2028","2029","2030"],"dados":[0,0,0,0,0,0],"cor":"#c9a84c"}]}
Substitua os zeros por dados reais do setor.`
  };
  const raw = await callAnthropic(prompts[tipo]);
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1) return { html: raw, graficos: [] };
    return JSON.parse(raw.substring(start, end + 1));
  } catch(e) {
    return { html: raw, graficos: [] };
  }
}

// ── Template de email ──
function gerarEmailHTML(nome, nicho, dateStr, data) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Radar de Mercado — ${nicho}</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:30px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:#0d1117;padding:32px 40px;border-bottom:4px solid #c9a84c;">
    <p style="margin:0;font-family:monospace;font-size:11px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase;">● Inteligência de Mercado</p>
    <h1 style="margin:10px 0 4px;font-size:32px;font-weight:700;color:#f5f0e8;letter-spacing:-1px;">RADAR DE MERCADO</h1>
    <p style="margin:0;font-size:15px;font-style:italic;color:#e8d4a0;">${nicho} · ${dateStr}</p>
  </td></tr>

  <!-- SAUDAÇÃO -->
  <tr><td style="background:#ede8dc;padding:20px 40px;border-bottom:1px solid #c8bfad;">
    <p style="margin:0;font-size:14px;color:#6b6357;font-family:monospace;">Olá, <strong style="color:#0d1117;">${nome}</strong>! Seu radar semanal está pronto.</p>
  </td></tr>

  <!-- NOVIDADES -->
  <tr><td style="background:#ffffff;padding:32px 40px;border-bottom:1px solid #ede8dc;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="36" style="vertical-align:top;">
          <div style="width:32px;height:32px;background:#0d1117;color:#f5f0e8;text-align:center;line-height:32px;font-size:15px;">📰</div>
        </td>
        <td style="padding-left:12px;vertical-align:top;">
          <h2 style="margin:0 0 4px;font-size:20px;color:#0d1117;border-bottom:2px solid #0d1117;padding-bottom:8px;">Novidades da Semana</h2>
        </td>
      </tr>
    </table>
    <div style="margin-top:16px;font-size:15px;line-height:1.75;color:#1a1a1a;">
      ${(data.novidades||'').replace(/class='highlight'/g, "style='border-left:3px solid #c9a84c;padding:10px 16px;background:rgba(201,168,76,.08);margin:14px 0;font-style:italic;'")}
    </div>
  </td></tr>

  <!-- CONCORRÊNCIA -->
  <tr><td style="background:#f5f0e8;padding:32px 40px;border-bottom:1px solid #ede8dc;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="36" style="vertical-align:top;">
          <div style="width:32px;height:32px;background:#0d1117;color:#f5f0e8;text-align:center;line-height:32px;font-size:15px;">⚔️</div>
        </td>
        <td style="padding-left:12px;vertical-align:top;">
          <h2 style="margin:0 0 4px;font-size:20px;color:#0d1117;border-bottom:2px solid #0d1117;padding-bottom:8px;">Movimentos da Concorrência</h2>
        </td>
      </tr>
    </table>
    <div style="margin-top:16px;font-size:15px;line-height:1.75;color:#1a1a1a;">${data.concorrencia||''}</div>
  </td></tr>

  <!-- OPORTUNIDADES -->
  <tr><td style="background:#ffffff;padding:32px 40px;border-bottom:1px solid #ede8dc;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="36" style="vertical-align:top;">
          <div style="width:32px;height:32px;background:#0d1117;color:#f5f0e8;text-align:center;line-height:32px;font-size:15px;">💡</div>
        </td>
        <td style="padding-left:12px;vertical-align:top;">
          <h2 style="margin:0 0 4px;font-size:20px;color:#0d1117;border-bottom:2px solid #0d1117;padding-bottom:8px;">Oportunidades de Mercado</h2>
        </td>
      </tr>
    </table>
    <div style="margin-top:16px;font-size:15px;line-height:1.75;color:#1a1a1a;">
      ${(data.oportunidades||'').replace(/class='highlight'/g, "style='border-left:3px solid #c9a84c;padding:10px 16px;background:rgba(201,168,76,.08);margin:14px 0;font-style:italic;'")}
    </div>
  </td></tr>

  <!-- TENDÊNCIAS -->
  <tr><td style="background:#f5f0e8;padding:32px 40px;border-bottom:1px solid #ede8dc;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="36" style="vertical-align:top;">
          <div style="width:32px;height:32px;background:#0d1117;color:#f5f0e8;text-align:center;line-height:32px;font-size:15px;">🔭</div>
        </td>
        <td style="padding-left:12px;vertical-align:top;">
          <h2 style="margin:0 0 4px;font-size:20px;color:#0d1117;border-bottom:2px solid #0d1117;padding-bottom:8px;">Tendências para os Próximos Anos</h2>
        </td>
      </tr>
    </table>
    <div style="margin-top:16px;font-size:15px;line-height:1.75;color:#1a1a1a;">${data.tendencias||''}</div>
  </td></tr>

  <!-- CTA -->
  <tr><td style="background:#0d1117;padding:28px 40px;text-align:center;">
    <p style="margin:0 0 16px;color:#e8d4a0;font-size:14px;">Acesse o site para gerar novos radares a qualquer momento</p>
    <a href="${RENDER_URL}" style="display:inline-block;background:#c9a84c;color:#0d1117;padding:12px 28px;font-family:monospace;font-size:12px;letter-spacing:1px;text-decoration:none;font-weight:bold;">→ ACESSAR O RADAR</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0d1117;padding:16px 40px;border-top:1px solid #1a1a2e;text-align:center;">
    <p style="margin:0;font-family:monospace;font-size:10px;color:#6b6357;letter-spacing:1px;">
      RADAR DE MERCADO · INTELIGÊNCIA GERADA POR IA<br>
      Você recebe este email pois se cadastrou como assinante.
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ── Envia email pelo Brevo ──
function enviarEmail(para, assunto, htmlContent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender: { name: 'Radar de Mercado', email: 'noreply@radar-mercado.com' },
      to: [{ email: para }],
      subject: assunto,
      htmlContent: htmlContent
    });
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log('Brevo response:', JSON.stringify(parsed));
          resolve(parsed);
        } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Envia para todos os assinantes ──
async function enviarParaTodos() {
  const assinantes = lerAssinantes().filter(a => a.ativo);
  const dateStr = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
  console.log(`Enviando radar para ${assinantes.length} assinantes...`);

  for (const assinante of assinantes) {
    try {
      const [novidades, concorrencia, oportunidades, tendencias] = await Promise.all([
        gerarSecao(assinante.setor, dateStr, 'novidades'),
        gerarSecao(assinante.setor, dateStr, 'concorrencia'),
        gerarSecao(assinante.setor, dateStr, 'oportunidades'),
        gerarSecao(assinante.setor, dateStr, 'tendencias')
      ]);
      const html = gerarEmailHTML(assinante.nome, assinante.setor, dateStr, { novidades, concorrencia, oportunidades, tendencias });
      await enviarEmail(assinante.email, `📡 Radar de Mercado — ${assinante.setor} · ${dateStr}`, html);
      console.log(`✓ Email enviado para ${assinante.email}`);
    } catch(e) {
      console.error(`✗ Erro ao enviar para ${assinante.email}:`, e.message);
    }
  }
}

// ── Servidor HTTP ──
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

  // Gerar radar
  if (req.method === 'POST' && req.url === '/api/radar') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        const { nicho, dateStr } = JSON.parse(body);
        console.log(`Gerando radar: ${nicho}`);
        const [novidades, concorrencia, oportunidades, tendencias] = await Promise.all([
          gerarSecao(nicho, dateStr, 'novidades'),
          gerarSecao(nicho, dateStr, 'concorrencia'),
          gerarSecao(nicho, dateStr, 'oportunidades'),
          gerarSecao(nicho, dateStr, 'tendencias')
        ]);
        // Extrai fontes de cada secao
        const novHtml = novidades.html || novidades;
        const conHtml = concorrencia.html || concorrencia;
        const opHtml = oportunidades.html || oportunidades;
        const tenHtml = tendencias.html || tendencias;
        function extrairFontes(html, secao) {
          const matches = [];
          const reg = /href=["']([^"']+)["']>([^<]+)<\/a>/g;
          let m;
          while ((m = reg.exec(html)) !== null) {
            if (m[1].startsWith('http')) matches.push({ url: m[1], nome: m[2], secao });
          }
          return matches;
        }
        const todasFontes = [
          ...extrairFontes(novHtml, 'Novidades'),
          ...extrairFontes(conHtml, 'Concorrência'),
          ...extrairFontes(opHtml, 'Oportunidades'),
          ...extrairFontes(tenHtml, 'Tendências')
        ];
        const fontesUnicas = todasFontes.filter((f, i, arr) => arr.findIndex(x => x.url === f.url) === i);
        const fontesHTML = fontesUnicas.length > 0
          ? '<ul>' + fontesUnicas.map(f =>
              '<li><span style="background:#0d1117;color:#f5f0e8;font-size:10px;padding:2px 7px;margin-right:6px;font-family:monospace;">' + f.secao + '</span><a href="' + f.url + '" target="_blank" style="color:#1a5f7a;">' + f.nome + '</a></li>'
            ).join('') + '</ul>'
          : '<p>Fontes listadas em cada seção acima.</p>';

        res.end(JSON.stringify({ success: true, data: {
          novidades: novHtml, novidades_graficos: novidades.graficos || [],
          concorrencia: conHtml, concorrencia_graficos: concorrencia.graficos || [],
          oportunidades: opHtml, oportunidades_graficos: oportunidades.graficos || [],
          tendencias: tenHtml, tendencias_graficos: tendencias.graficos || [],
          fontes: fontesHTML
        } }));
      } catch(e) {
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Gerar onepager
  if (req.method === 'POST' && req.url === '/api/onepager') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        const { nicho, dateStr } = JSON.parse(body);
        console.log('Gerando onepager:', nicho);

        const prompt = `Você é analista sênior de mercado. Data: ${dateStr}. Gere um resumo executivo VISUAL do mercado de "${nicho}" para um infográfico one-pager. Retorne APENAS JSON válido sem markdown:
{
  "titulo": "Título chamativo do one-pager",
  "subtitulo": "Subtítulo com contexto",
  "resumo": "2 frases resumindo o momento do mercado",
  "kpis": [
    {"label": "Nome do KPI", "valor": "Valor", "unidade": "unidade", "variacao": "+12%", "positivo": true},
    {"label": "Nome do KPI", "valor": "Valor", "unidade": "unidade", "variacao": "-3%", "positivo": false},
    {"label": "Nome do KPI", "valor": "Valor", "unidade": "unidade", "variacao": "+8%", "positivo": true},
    {"label": "Nome do KPI", "valor": "Valor", "unidade": "unidade", "variacao": "+25%", "positivo": true}
  ],
  "novidades": [
    {"titulo": "Título curto", "descricao": "1 frase descrevendo a novidade", "impacto": "alto"},
    {"titulo": "Título curto", "descricao": "1 frase descrevendo a novidade", "impacto": "medio"},
    {"titulo": "Título curto", "descricao": "1 frase descrevendo a novidade", "impacto": "baixo"}
  ],
  "mercado_chart": {
    "titulo": "Evolução do Mercado",
    "tipo": "line",
    "labels": ["2020","2021","2022","2023","2024","2025"],
    "dados": [100,115,132,148,167,189]
  },
  "players_chart": {
    "titulo": "Market Share (%)",
    "tipo": "doughnut",
    "labels": ["Player1","Player2","Player3","Player4","Outros"],
    "dados": [28,22,18,14,18]
  },
  "tendencias": [
    {"titulo": "Tendência 1", "descricao": "1 frase", "horizonte": "2025", "icone": "🤖"},
    {"titulo": "Tendência 2", "descricao": "1 frase", "horizonte": "2026", "icone": "📱"},
    {"titulo": "Tendência 3", "descricao": "1 frase", "horizonte": "2027", "icone": "🌱"},
    {"titulo": "Tendência 4", "descricao": "1 frase", "horizonte": "2028", "icone": "💡"}
  ],
  "oportunidade_destaque": "Descrição em 1-2 frases da maior oportunidade do momento",
  "alerta": "1 frase sobre principal risco ou ponto de atenção"
}
Use dados reais e específicos do setor "${nicho}".`;

        const raw = await callAnthropic(prompt);
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start === -1) throw new Error('JSON inválido');
        const data = JSON.parse(raw.substring(start, end + 1));
        res.end(JSON.stringify({ success: true, data }));
      } catch(e) {
        console.error('Erro onepager:', e.message);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Cadastrar assinante
  if (req.method === 'POST' && req.url === '/api/cadastrar') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        const { nome, email, setor } = JSON.parse(body);
        if (!nome || !email || !setor) throw new Error('Preencha todos os campos');
        adicionarAssinante(nome, email, setor);

        // Email de boas-vindas
        const dateStr = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
        const bemVindo = `<p>Olá ${nome}, seja bem-vindo ao Radar de Mercado!</p><p>Você receberá toda segunda-feira um relatório completo sobre <strong>${setor}</strong> direto no seu email.</p><p>Você também pode acessar o site a qualquer momento para gerar radares sob demanda.</p>`;
        await enviarEmail(email, '🎉 Bem-vindo ao Radar de Mercado!', gerarEmailHTML(nome, setor, dateStr, { novidades: bemVindo, concorrencia: '<p>Seu primeiro radar chegará na próxima segunda-feira.</p>', oportunidades: '<p>Fique atento às oportunidades do seu setor.</p>', tendencias: '<p>Análises de tendências semanais para você se manter à frente.</p>' }));

        res.end(JSON.stringify({ success: true, message: 'Cadastro realizado! Verifique seu email.' }));
      } catch(e) {
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Envio manual (teste)
  if (req.method === 'POST' && req.url === '/api/enviar-agora') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    enviarParaTodos().catch(console.error);
    res.end(JSON.stringify({ success: true, message: 'Envio iniciado!' }));
    return;
  }

  // Listar assinantes
  if (req.method === 'GET' && req.url === '/api/assinantes') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(lerAssinantes()));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.timeout = 60000;
server.listen(PORT, () => {
  console.log(`Radar Mercado rodando na porta ${PORT}`);
  agendarEnvioSemanal();
});

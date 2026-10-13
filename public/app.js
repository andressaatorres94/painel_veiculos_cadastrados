// ================== Configuração ==================

// Paleta categórica validada para daltonismo (a ordem importa: cor 1, 2, 3...)
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const COR_OUTROS = '#9aa3af';
const COR_SERIE = PALETA[0];
const INTERVALO_ATUALIZACAO = 60000;

const estado = {
    view: 'veiculos',
    pagina: 1,
    tamanho: 15,
    ordenar: 'data',
    direcao: 'desc',
    grafico: { por: 'tipoTitulo', gran: 'mes', tipo: 'barra' },
    coresTitulo: new Map(), // a cor acompanha o tipo de título em todo o sistema (cards, tabela e gráficos)
    carregando: false
};

const $ = id => document.getElementById(id);
let grafico = null;
let controladorPainel = null;
let controladorGrafico = null;

// ================== Utilitários ==================

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numero = n => Number(n || 0).toLocaleString('pt-BR');
const ehVerdadeiro = v => [true, 1, '1', 's', 'sim', 'true', 'y'].includes(typeof v === 'string' ? v.trim().toLowerCase() : v);

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// '2026-10-08 14:30:00.000' -> { data: '08/10/2026', hora: '14:30' }
function formatarData(valor) {
    if (!valor) return null;
    const p = String(valor).match(/\d+/g);
    if (!p || p.length < 3) return { data: esc(valor), hora: '' };
    return { data: `${p[2]}/${p[1]}/${p[0]}`, hora: p[3] ? `${p[3]}:${p[4]}` : '' };
}

function isoLocal(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function corTitulo(tipoTitulo) {
    return estado.coresTitulo.get(tipoTitulo) || COR_OUTROS;
}

// Escolhe texto branco ou escuro conforme a cor de fundo (contraste)
function corTextoSobre(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.3 ? '#1f2733' : '#ffffff';
}

function classeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (/desativ|inativ|bloque|cancel|suspens|negad/.test(s)) return 'critico';
    if (/pend|aguard|anális|analis|venc/.test(s)) return 'alerta';
    if (/ativ|liberad|aprovad|regular/.test(s)) return 'ok';
    return '';
}

function filtros() {
    return {
        categoria: $('f-categoria').value,
        tipoTitulo: $('f-tipo-titulo').value,
        titulo: $('f-titulo').value.trim(),
        carro: $('f-carro').value.trim(),
        tipo: $('f-tipo').value,
        status: $('f-status').value,
        de: $('f-de').value,
        ate: $('f-ate').value,
        busca: $('f-busca').value.trim()
    };
}

function montarQuery(params) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v); });
    return q.toString();
}

async function api(caminho, params = {}, signal) {
    const resposta = await fetch(`${caminho}?${montarQuery(params)}`, { signal });
    if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo.erro ? `${corpo.erro} (${corpo.detalhe || resposta.status})` : `Erro ${resposta.status}`);
    }
    return resposta.json();
}

function mostrarErro(mensagem) {
    const alerta = $('alerta-erro');
    if (!mensagem) { alerta.classList.add('d-none'); return; }
    alerta.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i>${esc(mensagem)}`;
    alerta.classList.remove('d-none');
}

function avisar(texto) {
    $('toast-texto').textContent = texto;
    bootstrap.Toast.getOrCreateInstance($('toast'), { delay: 3000 }).show();
}

function marcarAtualizacao() {
    $('ultima-atualizacao').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
}

function setCarregando(sim) {
    estado.carregando = sim;
    const btn = $('btn-atualizar');
    btn.disabled = sim;
    btn.querySelector('i').className = sim ? 'spinner-border spinner-border-sm' : 'bi bi-arrow-clockwise';
}

// ================== Opções dos filtros ==================

async function carregarOpcoes() {
    const opcoes = await api('/api/opcoes');

    opcoes.tiposTitulo.forEach((t, i) => estado.coresTitulo.set(t.valor, PALETA[i] || COR_OUTROS));

    const preencher = (select, valores) => {
        const atual = select.value;
        select.innerHTML = '<option value="">Todos</option>' +
            valores.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        select.value = atual;
    };
    preencher($('f-categoria'), opcoes.categorias || []);
    preencher($('f-tipo-titulo'), opcoes.tiposTitulo.map(t => t.valor));
    preencher($('f-tipo'), opcoes.tipos);
    preencher($('f-status'), opcoes.status);
}

// ================== Painel ==================

async function carregarPainel() {
    controladorPainel?.abort();
    controladorPainel = new AbortController();
    const { signal } = controladorPainel;

    const f = filtros();
    // Cards e categorias mostram todas as opções, mesmo com uma selecionada (para dar para trocar)
    const semTipoTitulo = { ...f, tipoTitulo: '' };
    const semCategoria = { ...f, categoria: '' };

    mostrarEsqueleto();
    setCarregando(true);

    try {
        const [lista, resumo, porTitulo, porCategoria] = await Promise.all([
            api('/api/veiculos', { ...f, pagina: estado.pagina, tamanho: estado.tamanho, ordenar: estado.ordenar, direcao: estado.direcao }, signal),
            api('/api/resumo', f, signal),
            api('/api/grafico', { ...semTipoTitulo, por: 'tipoTitulo', limite: 100 }, signal),
            api('/api/grafico', { ...semCategoria, por: 'categoria', limite: 20 }, signal)
        ]);

        renderizarCategorias(porCategoria, f.categoria);
        renderizarCards(porTitulo, f.tipoTitulo);
        renderizarIndicadores(resumo);
        renderizarTabela(lista);
        mostrarErro(null);
        marcarAtualizacao();
    } catch (erro) {
        if (erro.name === 'AbortError') return;
        mostrarErro(erro.message);
        $('tabela-veiculos').innerHTML = `<tr><td colspan="10" class="estado-vazio"><i class="bi bi-plug"></i>Não foi possível carregar os veículos.</td></tr>`;
    } finally {
        if (!signal.aborted) setCarregando(false);
    }
}

function mostrarEsqueleto() {
    const corpo = $('tabela-veiculos');
    if (corpo.dataset.carregado) return; // depois da primeira carga, mantém os dados na tela enquanto atualiza
    corpo.innerHTML = Array.from({ length: 8 }, () =>
        `<tr class="linha-esqueleto">${'<td><span></span></td>'.repeat(10)}</tr>`).join('');
    $('cards-titulo').innerHTML = '<div class="card-titulo carregando"></div>'.repeat(5);
}

function renderizarCards(porTitulo, tituloAtivo) {
    const total = porTitulo.reduce((s, t) => s + t.total, 0);
    const visiveis = porTitulo.slice(0, 11);

    // 'FUN - Funcionário' -> sigla 'FUN' no canto e 'Funcionário' como rótulo
    const card = (valor, qtd, cor, extra = '') => {
        const { sigla, nome } = valor ? separarTipo(valor) : { sigla: '', nome: 'Todos os tipos' };
        return `
        <button class="card-titulo ${extra} ${tituloAtivo === valor ? 'ativo' : ''}" data-titulo="${esc(valor)}"
                style="--cor:${cor};--cor-texto:${corTextoSobre(cor)}" title="${esc(valor || nome)}">
            ${sigla ? `<span class="sigla">${esc(sigla)}</span>` : '<i class="bi bi-collection icone"></i>'}
            <span class="numero">${numero(qtd)}</span>
            <span class="rotulo">${esc(nome)}</span>
        </button>`;
    };

    $('cards-titulo').innerHTML =
        card('', total, '#3c4757', 'todos') +
        visiveis.map(t => card(t.rotulo, t.total, corTitulo(t.rotulo))).join('');

    $('cards-titulo').classList.toggle('filtrando', !!tituloAtivo);
}

function separarTipo(valor) {
    const partes = String(valor).split(/\s*-\s+/);
    return partes.length > 1 ? { sigla: partes[0].trim(), nome: partes.slice(1).join(' - ').trim() } : { sigla: '', nome: valor };
}

const ICONES_CATEGORIA = { 'sócio': 'bi-person-badge', 'funcionário': 'bi-person-workspace', 'não sócio': 'bi-person' };

function renderizarCategorias(porCategoria, ativa) {
    const total = porCategoria.reduce((s, c) => s + c.total, 0);
    const botao = (valor, rotulo, qtd, icone) => `
        <button class="categoria ${ativa === valor ? 'ativo' : ''}" data-categoria="${esc(valor)}">
            <i class="bi ${icone}"></i><span>${esc(rotulo)}</span><strong>${numero(qtd)}</strong>
        </button>`;
    $('categorias').innerHTML =
        botao('', 'Todas', total, 'bi-people') +
        porCategoria.map(c => botao(c.rotulo, c.rotulo, c.total, ICONES_CATEGORIA[c.rotulo.toLowerCase()] || 'bi-person')).join('');
}

function renderizarIndicadores(resumo) {
    document.querySelectorAll('[data-kpi]').forEach(el => {
        el.textContent = numero(resumo[el.dataset.kpi]);
    });
}

function renderizarTabela({ linhas, total }) {
    const corpo = $('tabela-veiculos');
    corpo.dataset.carregado = '1';

    if (!linhas.length) {
        corpo.innerHTML = `<tr><td colspan="10" class="estado-vazio"><i class="bi bi-inbox"></i>Nenhum veículo encontrado para os filtros selecionados.</td></tr>`;
    } else {
        corpo.innerHTML = linhas.map(v => {
            const data = formatarData(v.DataInclusao);
            const isento = ehVerdadeiro(v.Isento);
            return `<tr>
                <td><span class="titulo-tag" style="--cor:${corTitulo(v.TipoTitulo)}">${esc(v.Titulo)}</span></td>
                <td class="tipo-titulo-celula">${v.TipoTitulo ? esc(separarTipo(v.TipoTitulo).nome) : '<span class="text-secondary">—</span>'}
                    ${v.CategoriaTitulo ? `<small>${esc(v.CategoriaTitulo)}</small>` : ''}</td>
                <td>${esc(v.Responsavel)}</td>
                <td>${esc(v.Carro)}</td>
                <td><span class="placa">${esc(String(v.Placa ?? '').toUpperCase())}</span></td>
                <td class="cod-acesso">${esc(v.CodAcesso)}</td>
                <td>${esc(v.Tipo)}</td>
                <td>${v.Status ? `<span class="status ${classeStatus(v.Status)}">${esc(v.Status)}</span>` : '<span class="text-secondary">—</span>'}</td>
                <td class="data-celula">${data ? `${data.data} <small>${data.hora}</small>` : '<span class="text-secondary">—</span>'}</td>
                <td>${isento ? '<span class="isento-sim"><i class="bi bi-check-circle-fill"></i> Isento</span>' : '<span class="isento-nao">Não</span>'}</td>
            </tr>`;
        }).join('');
    }

    const inicio = total ? (estado.pagina - 1) * estado.tamanho + 1 : 0;
    const fim = Math.min(estado.pagina * estado.tamanho, total);
    $('info-paginacao').textContent = `Exibindo ${numero(inicio)} a ${numero(fim)} de ${numero(total)} linhas`;
    renderizarPaginacao(Math.max(1, Math.ceil(total / estado.tamanho)));

    document.querySelectorAll('.tabela-veiculos th[data-ordenar]').forEach(th => {
        th.classList.remove('asc', 'desc');
        if (th.dataset.ordenar === estado.ordenar) th.classList.add(estado.direcao);
    });
}

function renderizarPaginacao(totalPaginas) {
    const atual = estado.pagina;
    const paginas = new Set([1, totalPaginas, atual - 1, atual, atual + 1].filter(p => p >= 1 && p <= totalPaginas));
    const ordenadas = [...paginas].sort((a, b) => a - b);

    const item = (pagina, rotulo, { ativo = false, desabilitado = false } = {}) =>
        `<li class="page-item ${ativo ? 'active' : ''} ${desabilitado ? 'disabled' : ''}">
            <a class="page-link" href="#" data-pagina="${pagina}">${rotulo}</a></li>`;

    let html = item(atual - 1, '<i class="bi bi-chevron-left"></i>', { desabilitado: atual === 1 });
    ordenadas.forEach((p, i) => {
        if (i > 0 && p - ordenadas[i - 1] > 1) html += item(0, '…', { desabilitado: true });
        html += item(p, p, { ativo: p === atual });
    });
    html += item(atual + 1, '<i class="bi bi-chevron-right"></i>', { desabilitado: atual === totalPaginas });
    $('paginacao').innerHTML = html;
}

// ================== Gráficos ==================

const NOMES_AGRUPAMENTO = {
    tipoTitulo: 'tipo de título', categoria: 'categoria', titulo: 'título', carro: 'veículo', tipo: 'tipo', status: 'status',
    dia: 'dia de inclusão', mes: 'mês de inclusão', ano: 'ano de inclusão'
};

function tiposDisponiveis() {
    return estado.grafico.por === 'data'
        ? [{ id: 'linha', icone: 'bi-graph-up', nome: 'Linha' }, { id: 'coluna', icone: 'bi-bar-chart', nome: 'Colunas' }]
        : [{ id: 'barra', icone: 'bi-bar-chart-steps', nome: 'Barras' }, { id: 'rosca', icone: 'bi-pie-chart', nome: 'Rosca' }];
}

function renderizarControlesGrafico() {
    const g = estado.grafico;
    const tipos = tiposDisponiveis();
    if (!tipos.some(t => t.id === g.tipo)) g.tipo = tipos[0].id;

    $('g-tipo').innerHTML = tipos.map(t =>
        `<button class="btn btn-outline-secondary ${t.id === g.tipo ? 'active' : ''}" data-tipo="${t.id}"><i class="bi ${t.icone}"></i> ${t.nome}</button>`).join('');
    $('g-granularidade-box').classList.toggle('d-none', g.por !== 'data');
    document.querySelectorAll('#g-agrupar button').forEach(b => b.classList.toggle('active', b.dataset.por === g.por));
    document.querySelectorAll('#g-granularidade button').forEach(b => b.classList.toggle('active', b.dataset.gran === g.gran));
}

// Completa os dias/meses sem cadastro com zero, para a linha do tempo não "pular" períodos
function preencherLacunas(itens, gran) {
    if (gran === 'ano' || itens.length < 2) return itens;
    const mapa = new Map(itens.map(i => [i.rotulo, i.total]));
    const resultado = [];
    const atual = new Date(`${itens[0].rotulo.slice(0, 7)}-${gran === 'dia' ? itens[0].rotulo.slice(8, 10) : '01'}T00:00:00`);
    const ultimo = itens[itens.length - 1].rotulo;
    for (let i = 0; i < 2000; i++) {
        const chave = gran === 'dia' ? isoLocal(atual) : isoLocal(atual).slice(0, 7);
        if (chave > ultimo) break;
        resultado.push({ rotulo: chave, total: mapa.get(chave) || 0 });
        gran === 'dia' ? atual.setDate(atual.getDate() + 1) : atual.setMonth(atual.getMonth() + 1);
    }
    return resultado;
}

function rotuloData(chave, gran) {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    if (gran === 'ano') return chave;
    if (gran === 'mes') return `${meses[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`;
    return `${chave.slice(8, 10)}/${chave.slice(5, 7)}/${chave.slice(2, 4)}`;
}

function descreverFiltros(f) {
    const partes = [];
    if (f.categoria) partes.push(`Categoria: ${f.categoria}`);
    if (f.tipoTitulo) partes.push(`Tipo de título: ${f.tipoTitulo}`);
    if (f.titulo) partes.push(`Título: ${f.titulo}`);
    if (f.carro) partes.push(`Veículo: ${f.carro}`);
    if (f.tipo) partes.push(`Tipo: ${f.tipo}`);
    if (f.status) partes.push(`Status: ${f.status}`);
    if (f.de || f.ate) partes.push(`Inclusão: ${f.de ? formatarData(f.de).data : '…'} a ${f.ate ? formatarData(f.ate).data : 'hoje'}`);
    if (f.busca) partes.push(`Pesquisa: "${f.busca}"`);
    return partes.length ? partes.join(' · ') : 'Todos os veículos cadastrados';
}

async function carregarGrafico() {
    controladorGrafico?.abort();
    controladorGrafico = new AbortController();
    const { signal } = controladorGrafico;

    const g = estado.grafico;
    const f = filtros();
    const por = g.por === 'data' ? g.gran : g.por;
    const ehRosca = g.tipo === 'rosca';
    const limite = ehRosca ? 7 : 15;

    renderizarControlesGrafico();
    setCarregando(true);

    try {
        const [itens, resumo] = await Promise.all([
            api('/api/grafico', { ...f, por, limite }, signal),
            api('/api/resumo', f, signal)
        ]);

        let dados = g.por === 'data' ? preencherLacunas(itens, g.gran) : itens;
        const somaVisivel = dados.reduce((s, i) => s + i.total, 0);
        const outros = g.por === 'data' ? 0 : resumo.total - somaVisivel;
        if (outros > 0) dados = [...dados, { rotulo: 'Outros', total: outros, outros: true }];

        $('g-titulo').textContent = `Veículos cadastrados por ${NOMES_AGRUPAMENTO[por]}`;
        $('g-subtitulo').textContent = descreverFiltros(f);
        $('g-coluna').textContent = NOMES_AGRUPAMENTO[por].replace(/^./, c => c.toUpperCase());

        desenharGrafico(dados, por, resumo.total);
        renderizarTabelaGrafico(dados, por, resumo.total);
        mostrarErro(null);
        marcarAtualizacao();
    } catch (erro) {
        if (erro.name === 'AbortError') return;
        mostrarErro(erro.message);
    } finally {
        if (!signal.aborted) setCarregando(false);
    }
}

function coresPara(dados, por) {
    return dados.map((d, i) => {
        if (d.outros) return COR_OUTROS;
        if (por === 'tipoTitulo') return corTitulo(d.rotulo);
        return estado.grafico.tipo === 'rosca' ? PALETA[i] || COR_OUTROS : COR_SERIE;
    });
}

function desenharGrafico(dados, por, total) {
    const g = estado.grafico;
    const vazio = !dados.length || total === 0;
    $('grafico-vazio').classList.toggle('d-none', !vazio);
    grafico?.destroy();
    grafico = null;
    if (vazio) return;

    const porData = ['dia', 'mes', 'ano'].includes(por);
    const rotulos = dados.map(d => (porData ? rotuloData(d.rotulo, por) : d.rotulo));
    const valores = dados.map(d => d.total);
    const cores = coresPara(dados, por);
    const pct = v => (total ? ((v / total) * 100).toFixed(1).replace('.', ',') : '0');

    const tooltip = {
        backgroundColor: '#1f2733', padding: 10, cornerRadius: 6, displayColors: g.tipo === 'rosca',
        callbacks: { label: ctx => ` ${numero(ctx.raw)} veículos (${pct(ctx.raw)}%)` }
    };
    const grade = { color: '#eef1f5' };
    const eixo = { color: '#5b6676' };

    const configs = {
        barra: {
            type: 'bar',
            data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: cores, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 }] },
            options: {
                indexAxis: 'y',
                scales: { x: { beginAtZero: true, grid: grade, ticks: { ...eixo, precision: 0 } }, y: { grid: { display: false }, ticks: eixo } },
                plugins: { legend: { display: false }, tooltip }
            }
        },
        coluna: {
            type: 'bar',
            data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: COR_SERIE, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 40 }] },
            options: {
                scales: { y: { beginAtZero: true, grid: grade, ticks: { ...eixo, precision: 0 } }, x: { grid: { display: false }, ticks: { ...eixo, maxRotation: 0, autoSkip: true } } },
                plugins: { legend: { display: false }, tooltip }
            }
        },
        linha: {
            type: 'line',
            data: {
                labels: rotulos,
                datasets: [{
                    data: valores, borderColor: COR_SERIE, backgroundColor: 'rgba(42,120,214,.12)', fill: true,
                    borderWidth: 2, tension: .25, pointRadius: dados.length > 60 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: COR_SERIE
                }]
            },
            options: {
                interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true, grid: grade, ticks: { ...eixo, precision: 0 } }, x: { grid: { display: false }, ticks: { ...eixo, maxRotation: 0, autoSkip: true } } },
                plugins: { legend: { display: false }, tooltip }
            }
        },
        rosca: {
            type: 'doughnut',
            data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: cores, borderColor: '#fff', borderWidth: 2, hoverOffset: 6 }] },
            options: {
                cutout: '62%',
                plugins: {
                    legend: { position: 'right', labels: { color: '#1f2733', boxWidth: 12, boxHeight: 12, padding: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
                    tooltip: { ...tooltip, callbacks: { label: ctx => ` ${ctx.label}: ${numero(ctx.raw)} (${pct(ctx.raw)}%)` } }
                }
            }
        }
    };

    const config = configs[g.tipo];
    config.options = { ...config.options, responsive: true, maintainAspectRatio: false, animation: { duration: 350 } };
    grafico = new Chart($('grafico'), config);
}

function renderizarTabelaGrafico(dados, por, total) {
    const porData = ['dia', 'mes', 'ano'].includes(por);
    const linhas = (porData ? [...dados].reverse() : dados).filter(d => d.total > 0);
    const pct = v => (total ? ((v / total) * 100).toFixed(1).replace('.', ',') : '0');
    const cores = coresPara(dados, por);
    const corDe = new Map(dados.map((d, i) => [d.rotulo, cores[i]]));

    $('g-tabela').innerHTML = linhas.length
        ? linhas.map(d => `<tr>
            <td title="${esc(d.rotulo)}">${por === 'tipoTitulo' || estado.grafico.tipo === 'rosca' ? `<span class="titulo-tag" style="--cor:${corDe.get(d.rotulo)}">` : '<span>'}${esc(porData ? rotuloData(d.rotulo, por) : d.rotulo)}</span></td>
            <td class="text-end">${numero(d.total)}</td>
            <td class="text-end text-secondary">${pct(d.total)}%</td></tr>`).join('') +
          `<tr class="fw-semibold"><td>Total</td><td class="text-end">${numero(total)}</td><td class="text-end">100%</td></tr>`
        : '<tr><td colspan="3" class="estado-vazio">Sem dados</td></tr>';
}

// ================== Navegação ==================

function recarregar() {
    if (estado.view === 'graficos') carregarGrafico();
    else carregarPainel();
}

function trocarView() {
    estado.view = location.hash === '#/graficos' ? 'graficos' : 'veiculos';
    $('view-veiculos').classList.toggle('d-none', estado.view !== 'veiculos');
    $('view-graficos').classList.toggle('d-none', estado.view !== 'graficos');
    document.querySelectorAll('.menu-item[data-view]').forEach(a => a.classList.toggle('ativo', a.dataset.view === estado.view));
    $('breadcrumb-atual').textContent = estado.view === 'graficos' ? 'Gráficos' : 'Painel';
    document.body.classList.remove('menu-aberto');
    recarregar();
}

function aoMudarFiltro() {
    estado.pagina = 1;
    recarregar();
}

async function baixarRelatorio() {
    const btn = $('btn-relatorio');
    const htmlOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> <span class="d-none d-md-inline">Gerando…</span>';
    try {
        const resposta = await fetch(`/relatorio?${montarQuery(filtros())}`);
        if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).erro || `Erro ${resposta.status}`);
        const blob = await resposta.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Relatorio_Veiculos_${isoLocal(new Date())}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
        avisar('Relatório gerado com os filtros aplicados.');
    } catch (erro) {
        mostrarErro(`Falha ao gerar o relatório: ${erro.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = htmlOriginal;
    }
}

// ================== Eventos ==================

function registrarEventos() {
    ['f-categoria', 'f-tipo-titulo', 'f-tipo', 'f-status'].forEach(id => $(id).addEventListener('change', aoMudarFiltro));
    ['f-de', 'f-ate'].forEach(id => $(id).addEventListener('change', () => {
        document.querySelectorAll('[data-periodo]').forEach(b => b.classList.remove('ativo'));
        aoMudarFiltro();
    }));
    const digitar = debounce(aoMudarFiltro, 350);
    ['f-titulo', 'f-carro', 'f-busca'].forEach(id => $(id).addEventListener('input', digitar));

    document.querySelectorAll('[data-periodo]').forEach(btn => btn.addEventListener('click', () => {
        const dias = Number(btn.dataset.periodo);
        const inicio = new Date();
        inicio.setDate(inicio.getDate() - dias);
        $('f-de').value = isoLocal(inicio);
        $('f-ate').value = isoLocal(new Date());
        document.querySelectorAll('[data-periodo]').forEach(b => b.classList.toggle('ativo', b === btn));
        aoMudarFiltro();
    }));

    $('btn-limpar').addEventListener('click', () => {
        ['f-categoria', 'f-tipo-titulo', 'f-titulo', 'f-carro', 'f-tipo', 'f-status', 'f-de', 'f-ate', 'f-busca'].forEach(id => { $(id).value = ''; });
        document.querySelectorAll('[data-periodo]').forEach(b => b.classList.remove('ativo'));
        aoMudarFiltro();
    });

    $('categorias').addEventListener('click', e => {
        const botao = e.target.closest('[data-categoria]');
        if (!botao) return;
        const categoria = botao.dataset.categoria;
        $('f-categoria').value = $('f-categoria').value === categoria ? '' : categoria;
        aoMudarFiltro();
    });

    $('cards-titulo').addEventListener('click', e => {
        const card = e.target.closest('.card-titulo[data-titulo]');
        if (!card) return;
        const tipo = card.dataset.titulo;
        $('f-tipo-titulo').value = $('f-tipo-titulo').value === tipo ? '' : tipo; // clicar de novo remove o filtro
        aoMudarFiltro();
    });

    document.querySelectorAll('.tabela-veiculos th[data-ordenar]').forEach(th => th.addEventListener('click', () => {
        const coluna = th.dataset.ordenar;
        estado.direcao = estado.ordenar === coluna && estado.direcao === 'asc' ? 'desc' : 'asc';
        estado.ordenar = coluna;
        estado.pagina = 1;
        carregarPainel();
    }));

    $('paginacao').addEventListener('click', e => {
        e.preventDefault();
        const link = e.target.closest('[data-pagina]');
        const pagina = Number(link?.dataset.pagina);
        if (!pagina || link.parentElement.classList.contains('disabled')) return;
        estado.pagina = pagina;
        carregarPainel();
    });

    $('tamanho-pagina').addEventListener('change', e => {
        estado.tamanho = Number(e.target.value);
        estado.pagina = 1;
        carregarPainel();
    });

    $('g-agrupar').addEventListener('click', e => {
        const btn = e.target.closest('[data-por]');
        if (!btn) return;
        estado.grafico.por = btn.dataset.por;
        carregarGrafico();
    });
    $('g-granularidade').addEventListener('click', e => {
        const btn = e.target.closest('[data-gran]');
        if (!btn) return;
        estado.grafico.gran = btn.dataset.gran;
        carregarGrafico();
    });
    $('g-tipo').addEventListener('click', e => {
        const btn = e.target.closest('[data-tipo]');
        if (!btn) return;
        estado.grafico.tipo = btn.dataset.tipo;
        carregarGrafico();
    });

    $('btn-atualizar').addEventListener('click', recarregar);
    $('btn-relatorio').addEventListener('click', baixarRelatorio);
    $('menu-relatorio').addEventListener('click', e => { e.preventDefault(); baixarRelatorio(); });

    $('btn-recolher').addEventListener('click', () => {
        const recolhido = document.body.classList.toggle('menu-recolhido');
        try { localStorage.setItem('menuRecolhido', recolhido ? '1' : ''); } catch { /* sem armazenamento */ }
        setTimeout(() => grafico?.resize(), 220);
    });
    $('btn-menu-mobile').addEventListener('click', () => document.body.classList.toggle('menu-aberto'));
    document.addEventListener('click', e => {
        if (document.body.classList.contains('menu-aberto') && !e.target.closest('.sidebar, #btn-menu-mobile')) {
            document.body.classList.remove('menu-aberto');
        }
    });

    window.addEventListener('hashchange', trocarView);

    // Atualização automática: só com a aba visível e sem outra carga em andamento
    setInterval(() => { if (!document.hidden && !estado.carregando) recarregar(); }, INTERVALO_ATUALIZACAO);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) recarregar(); });
}

// ================== Início ==================

async function iniciar() {
    try { if (localStorage.getItem('menuRecolhido')) document.body.classList.add('menu-recolhido'); } catch { /* sem armazenamento */ }

    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#5b6676';

    registrarEventos();

    fetch('/api/saude').then(r => r.json()).then(s => $('badge-demo').classList.toggle('d-none', !s.demo)).catch(() => { });

    try {
        await carregarOpcoes();
    } catch (erro) {
        mostrarErro(`Não foi possível carregar os filtros: ${erro.message}`);
    }
    trocarView();
}

iniciar();

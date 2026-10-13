require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const ExcelJS = require('exceljs');
const path = require('path');

const MODO_DEMO = process.env.MODO_DEMO === '1' || process.argv.includes('--demo');
const repo = MODO_DEMO ? require('./repo-demo') : require('./repo-sql');
const PORTA = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

// Lê os filtros da query string (mesmos filtros para tabela, cards, gráficos e Excel)
function lerFiltros(q) {
    const texto = v => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
    const data = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    return {
        tipoTitulo: texto(q.tipoTitulo),
        categoria: texto(q.categoria),
        titulo: texto(q.titulo),
        tipo: texto(q.tipo),
        status: texto(q.status),
        carro: texto(q.carro),
        busca: texto(q.busca),
        de: data(q.de),
        ate: data(q.ate)
    };
}

const inteiro = (v, padrao, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || padrao));

// Envolve as rotas async para centralizar o tratamento de erro
const rota = fn => async (req, res) => {
    try {
        await fn(req, res);
    } catch (erro) {
        // O pacote odbc guarda a mensagem real do SQL Server em odbcErrors
        const detalhe = erro.odbcErrors?.map(e => e.message).join(' | ') || erro.message;
        console.error(`[${new Date().toLocaleString('pt-BR')}] ${req.method} ${req.originalUrl}:`, detalhe);
        if (!res.headersSent) {
            res.status(500).json({ erro: 'Não foi possível consultar o banco de dados.', detalhe });
        } else {
            res.end();
        }
    }
};

// Lista paginada de veículos
app.get('/api/veiculos', rota(async (req, res) => {
    const resultado = await repo.listar(lerFiltros(req.query), {
        pagina: inteiro(req.query.pagina, 1, 1, 100000),
        tamanho: inteiro(req.query.tamanho, 15, 5, 200),
        ordenar: req.query.ordenar,
        direcao: req.query.direcao
    });
    res.json(resultado);
}));

// Números dos cards (total, hoje, 7 dias, 30 dias, isentos)
app.get('/api/resumo', rota(async (req, res) => {
    res.json(await repo.resumo(lerFiltros(req.query)));
}));

// Opções dos filtros (títulos com contagem, tipos e status)
app.get('/api/opcoes', rota(async (req, res) => {
    res.json(await repo.opcoes());
}));

// Dados agregados para os gráficos
app.get('/api/grafico', rota(async (req, res) => {
    const por = req.query.por;
    if (!repo.AGRUPAMENTOS[por]) {
        return res.status(400).json({ erro: 'Agrupamento inválido.' });
    }
    res.json(await repo.agrupar(por, lerFiltros(req.query), inteiro(req.query.limite, 15, 1, 100)));
}));

app.get('/api/saude', rota(async (req, res) => {
    await repo.saude();
    res.json({ ok: true, demo: MODO_DEMO });
}));

// Relatório Excel (respeita os filtros aplicados na tela)
const COLUNAS_EXCEL = [
    { header: 'Título', key: 'Titulo', width: 16 },
    { header: 'Tipo de Título', key: 'TipoTitulo', width: 30 },
    { header: 'Categoria', key: 'CategoriaTitulo', width: 14 },
    { header: 'Responsável', key: 'Responsavel', width: 30 },
    { header: 'Carro', key: 'Carro', width: 22 },
    { header: 'Placa', key: 'Placa', width: 12 },
    { header: 'Código de Acesso', key: 'CodAcesso', width: 18 },
    { header: 'Tipo', key: 'Tipo', width: 12 },
    { header: 'Status', key: 'Status', width: 12 },
    { header: 'Data Inclusão', key: 'DataInclusao', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Isento', key: 'Isento', width: 10 }
];

// '2026-10-08 14:00:00.000' (como o ODBC devolve) -> Date em UTC, para o Excel não deslocar o fuso
function dataExcel(v) {
    if (!v) return null;
    const p = String(v instanceof Date ? v.toISOString() : v).match(/\d+/g).map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0, p[5] || 0));
}

const ehVerdadeiro = v => [true, 1, '1', 's', 'sim', 'true', 'y'].includes(typeof v === 'string' ? v.trim().toLowerCase() : v);

app.get('/relatorio', rota(async (req, res) => {
    const dados = await repo.todos(lerFiltros(req.query));

    const workbook = new ExcelJS.Workbook();
    const planilha = workbook.addWorksheet('Veículos', { views: [{ state: 'frozen', ySplit: 1 }] });
    planilha.columns = COLUNAS_EXCEL;

    planilha.addRows(dados.map(v => ({
        ...v,
        DataInclusao: dataExcel(v.DataInclusao),
        Isento: ehVerdadeiro(v.Isento) ? 'Sim' : 'Não'
    })));

    const cabecalho = planilha.getRow(1);
    cabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    cabecalho.alignment = { vertical: 'middle' };
    cabecalho.height = 22;
    planilha.autoFilter = { from: 'A1', to: { row: 1, column: COLUNAS_EXCEL.length } };

    const hoje = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Relatorio_Veiculos_${hoje}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
}));

app.listen(PORTA, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORTA}${MODO_DEMO ? ' (MODO DEMONSTRAÇÃO - dados fictícios)' : ''}`);
});

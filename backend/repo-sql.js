// Acesso ao SQL Server via ODBC (DSN configurado no Windows)
const odbc = require('odbc');

// DSN do Windows (configurado no .env) + usuário/senha opcionais (autenticação SQL; o DSN não guarda senha)
const CONNECTION_STRING = [
    `DSN=${process.env.DB_DSN}`,
    process.env.DB_USUARIO && `UID=${process.env.DB_USUARIO}`,
    process.env.DB_SENHA && `PWD={${process.env.DB_SENHA.replace(/}/g, '}}')}}`
].filter(Boolean).join(';') + ';';

const TABELA = 'Veiculos_Cadastrados';

// Nome real da coluna de data no banco (com ou sem acento) - ajuste no .env se precisar
const COL_DATA_ORIGINAL = `[${(process.env.COL_DATA_INCLUSAO || 'DataInclusao').replace(/[\[\]]/g, '')}]`;

// A data vem como texto 'dd/mm/aaaa hh:mm' -> converte para datetime (estilo 103 = dd/mm/aaaa).
// Se a coluna já for datetime, a conversão não altera nada. Valores inválidos viram NULL.
const COL_DATA = `TRY_CONVERT(datetime, ${COL_DATA_ORIGINAL}, 103)`;

// Tipo e categoria do título vêm da própria view:
// TipoTitulo = 'FUN - Funcionário', CategoriaTitulo = 'Sócio' / 'Funcionário' / 'Não Sócio'
const EXPR_TIPO_TITULO = `LTRIM(RTRIM(TipoTitulo))`;

// Colunas varchar chegam com acento quebrado pelo driver ODBC; em nvarchar vêm corretas
const nv = (coluna, tamanho = 50) => `CAST(${coluna} AS nvarchar(${tamanho}))`;
const EXPR_CATEGORIA = nv('CategoriaTitulo');
const EXPR_TIPO = nv('Tipo');
const EXPR_STATUS = nv('Status');

// Remove tabs e espaços que vêm no cadastro ('PALIO\t')
const EXPR_CARRO = `LTRIM(RTRIM(REPLACE(Carro, CHAR(9), '')))`;

const COLUNAS = `Titulo, ${EXPR_TIPO_TITULO} AS TipoTitulo, ${EXPR_CATEGORIA} AS CategoriaTitulo, Responsavel,
                 ${EXPR_CARRO} AS Carro, Placa, CodAcesso, ${EXPR_TIPO} AS Tipo, ${EXPR_STATUS} AS Status,
                 ${COL_DATA} AS DataInclusao, ${nv('Isento', 10)} AS Isento`;

// Colunas permitidas para ordenação e agrupamento (nunca concatenar texto do usuário no SQL)
const COLUNAS_ORDENACAO = {
    titulo: 'Titulo', tipotitulo: EXPR_TIPO_TITULO, categoria: EXPR_CATEGORIA, responsavel: 'Responsavel', carro: EXPR_CARRO,
    placa: 'Placa', codacesso: 'CodAcesso', tipo: 'Tipo', status: 'Status', data: COL_DATA, isento: 'Isento'
};

const AGRUPAMENTOS = {
    tipoTitulo: EXPR_TIPO_TITULO,
    categoria: EXPR_CATEGORIA,
    titulo: 'Titulo',
    carro: EXPR_CARRO,
    tipo: EXPR_TIPO,
    status: EXPR_STATUS,
    dia: `CONVERT(char(10), ${COL_DATA}, 23)`,
    mes: `CONVERT(char(7), ${COL_DATA}, 23)`,
    ano: `CONVERT(char(4), ${COL_DATA}, 23)`
};

const EXPR_ISENTO = `CASE WHEN CAST(Isento AS varchar(10)) IN ('1','S','SIM','True','Y') THEN 1 ELSE 0 END`;

// Pool criado uma única vez e reaproveitado entre as requisições
let poolPromise = null;
function obterPool() {
    if (!process.env.DB_DSN) {
        return Promise.reject(new Error('DB_DSN não configurado. Copie backend/.env.example para backend/.env e informe o DSN.'));
    }
    if (!poolPromise) {
        poolPromise = odbc.pool(CONNECTION_STRING).catch(erro => {
            poolPromise = null; // permite nova tentativa na próxima requisição
            throw erro;
        });
    }
    return poolPromise;
}

async function consultar(sql, params = []) {
    const pool = await obterPool();
    return pool.query(sql, params);
}

// 'AAAA-MM-DD' -> 'AAAAMMDD' (formato que o SQL Server entende igual em qualquer idioma)
function dataSql(iso, somarDias = 0) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + somarDias);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// O pacote odbc envia texto como bytes UTF-8 e o driver os lê em outra codificação:
// 'Funcionário' chegava ao banco como 'FuncionÃ¡rio' e nenhum filtro com acento batia.
// Por isso o texto vai como literal hexadecimal UTF-16 (0x...) e o próprio SQL converte de volta.
// É seguro montar no SQL: o resultado só contém 0-9 e a-f (o driver antigo não aceita '?' dentro de função).
function textoSql(valor) {
    const hex = Buffer.from(String(valor), 'utf16le').toString('hex');
    if (!/^[0-9a-f]*$/.test(hex)) throw new Error('Valor de filtro inválido.');
    return `CAST(0x${hex} AS nvarchar(2000))`;
}

function montarWhere(f, extras = []) {
    const cond = [...extras];
    const params = [];
    const igual = (expr, valor) => cond.push(`${expr} = ${textoSql(valor)}`);
    const contem = (expr, valor) => cond.push(`${expr} LIKE ${textoSql(`%${valor}%`)}`);

    if (f.tipoTitulo) igual(EXPR_TIPO_TITULO, f.tipoTitulo);
    if (f.categoria) igual(EXPR_CATEGORIA, f.categoria);
    if (f.titulo) contem('Titulo', f.titulo);
    if (f.tipo) igual(EXPR_TIPO, f.tipo);
    if (f.status) igual(EXPR_STATUS, f.status);
    if (f.carro) contem('Carro', f.carro);
    if (f.busca) {
        const termo = textoSql(`%${f.busca}%`);
        cond.push(`(${['Titulo', 'Responsavel', 'Carro', 'Placa'].map(c => `${c} LIKE ${termo}`).join(' OR ')})`);
    }
    if (f.de) { cond.push(`${COL_DATA} >= ?`); params.push(dataSql(f.de)); }
    if (f.ate) { cond.push(`${COL_DATA} < ?`); params.push(dataSql(f.ate, 1)); }

    return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

const texto = v => (v == null ? v : String(v).trim());

async function listar(f, { pagina, tamanho, ordenar, direcao }) {
    const { where, params } = montarWhere(f);
    const coluna = COLUNAS_ORDENACAO[ordenar] || COL_DATA;
    const dir = direcao === 'asc' ? 'ASC' : 'DESC';
    const offset = (pagina - 1) * tamanho;

    const [linhas, contagem] = await Promise.all([
        consultar(`
            SELECT ${COLUNAS} FROM ${TABELA} ${where}
            ORDER BY ${coluna} ${dir}
            OFFSET ${offset} ROWS FETCH NEXT ${tamanho} ROWS ONLY`, params),
        consultar(`SELECT COUNT(*) AS total FROM ${TABELA} ${where}`, params)
    ]);

    return { linhas: [...linhas].map(l => ({ ...l, Status: texto(l.Status) })), total: Number(contagem[0].total) };
}

async function todos(f) {
    const { where, params } = montarWhere(f);
    const linhas = await consultar(`SELECT ${COLUNAS} FROM ${TABELA} ${where} ORDER BY Titulo, ${COL_DATA} DESC`, params);
    return [...linhas];
}

async function resumo(f) {
    const { where, params } = montarWhere(f);
    const [r] = await consultar(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN CAST(${COL_DATA} AS date) = CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS hoje,
            SUM(CASE WHEN ${COL_DATA} >= DATEADD(day, -7, CAST(GETDATE() AS date)) THEN 1 ELSE 0 END) AS semana,
            SUM(CASE WHEN ${COL_DATA} >= DATEADD(day, -30, CAST(GETDATE() AS date)) THEN 1 ELSE 0 END) AS mes,
            SUM(${EXPR_ISENTO}) AS isentos
        FROM ${TABELA} ${where}`, params);

    return {
        total: Number(r.total) || 0,
        hoje: Number(r.hoje) || 0,
        semana: Number(r.semana) || 0,
        mes: Number(r.mes) || 0,
        isentos: Number(r.isentos) || 0
    };
}

async function agrupar(por, f, limite) {
    const expr = AGRUPAMENTOS[por];
    const porData = ['dia', 'mes', 'ano'].includes(por);
    // Na linha do tempo, ignora registros com data inválida
    const { where, params } = montarWhere(f, porData ? [`${COL_DATA} IS NOT NULL`] : []);

    const linhas = await consultar(`
        SELECT ${porData ? '' : `TOP ${limite}`} ${expr} AS rotulo, COUNT(*) AS total
        FROM ${TABELA} ${where}
        GROUP BY ${expr}
        ORDER BY ${porData ? 'rotulo ASC' : 'total DESC'}`, params);

    return [...linhas].map(l => ({
        rotulo: l.rotulo == null || String(l.rotulo).trim() === '' ? '(vazio)' : String(l.rotulo).trim(),
        total: Number(l.total)
    }));
}

async function opcoes() {
    const distintos = expr => consultar(`SELECT DISTINCT ${expr} AS valor FROM ${TABELA} WHERE ${expr} IS NOT NULL ORDER BY valor`);
    const [tiposTitulo, categorias, tipos, status] = await Promise.all([
        consultar(`SELECT ${EXPR_TIPO_TITULO} AS valor, COUNT(*) AS total FROM ${TABELA} GROUP BY ${EXPR_TIPO_TITULO} ORDER BY total DESC`),
        distintos(EXPR_CATEGORIA),
        distintos(EXPR_TIPO),
        distintos(EXPR_STATUS)
    ]);
    return {
        tiposTitulo: [...tiposTitulo].filter(t => t.valor).map(t => ({ valor: String(t.valor).trim(), total: Number(t.total) })),
        categorias: [...categorias].map(c => String(c.valor).trim()),
        tipos: [...tipos].map(t => String(t.valor).trim()),
        status: [...status].map(s => String(s.valor).trim())
    };
}

async function saude() {
    await consultar('SELECT 1 AS ok');
}

module.exports = { listar, todos, resumo, agrupar, opcoes, saude, AGRUPAMENTOS, COLUNAS_ORDENACAO };

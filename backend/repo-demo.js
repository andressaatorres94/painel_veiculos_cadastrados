// Dados fictícios para testar o front sem acesso ao banco (MODO_DEMO=1 no .env)
const { AGRUPAMENTOS } = require('./repo-sql');

// Prefixos de título no mesmo formato do banco real ('A28223', 'FUN1256-0', 'N/S21873')
const TIPOS_TITULO = ['A', 'B', 'FUN', 'EST', 'SAE', 'N/S', 'C', 'BD'];
const NOMES_TIPO = {
    A: ['A - Patrimonial', 'Sócio'], B: ['B - Patrimonial', 'Sócio'], FUN: ['FUN - Funcionário', 'Funcionário'],
    EST: ['EST - Estagiários', 'Funcionário'], SAE: ['SAE - Aspirante', 'Sócio'], 'N/S': ['N/S - Não Sócio', 'Não Sócio'],
    C: ['C - Convidado', 'Não Sócio'], BD: ['BD - Patrimonial Dependente', 'Sócio']
};
const PESOS = [40, 22, 14, 9, 5, 5, 3, 2];
const CARROS = ['Fiat Argo', 'VW Gol', 'Chevrolet Onix', 'Hyundai HB20', 'Toyota Corolla', 'Jeep Compass', 'Honda Civic', 'Renault Kwid', 'Honda CG 160', 'Yamaha Fazer 250'];
const NOMES = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elisa Prado', 'Fábio Nunes', 'Gabriela Reis', 'Heitor Alves', 'Isabela Costa', 'João Pereira', 'Karina Melo', 'Lucas Martins'];
const STATUS = ['Ativo', 'Ativo', 'Ativo', 'Ativo', 'Desativado', null];

// Gerador pseudoaleatório com semente fixa: os mesmos dados a cada execução
let semente = 42;
const aleatorio = () => ((semente = (semente * 16807) % 2147483647) - 1) / 2147483646;
const escolher = lista => lista[Math.floor(aleatorio() * lista.length)];
function escolherPeso(lista, pesos) {
    let r = aleatorio() * pesos.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lista.length; i++) if ((r -= pesos[i]) < 0) return lista[i];
    return lista[0];
}

// Mesmo formato que o ODBC devolve: 'AAAA-MM-DD HH:MM:SS.000'
function formatarLocal(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00.000`;
}

const hoje = new Date();
const DADOS = Array.from({ length: 420 }, () => {
    const carro = escolher(CARROS);
    const data = new Date(hoje);
    data.setDate(data.getDate() - Math.floor(aleatorio() ** 1.6 * 365));
    data.setHours(7 + Math.floor(aleatorio() * 12), Math.floor(aleatorio() * 60));
    const letras = () => String.fromCharCode(65 + Math.floor(aleatorio() * 26));
    const tipoTitulo = escolherPeso(TIPOS_TITULO, PESOS);
    const numero = 1000 + Math.floor(aleatorio() * 29000);
    return {
        Titulo: tipoTitulo === 'FUN' || tipoTitulo === 'SAE' ? `${tipoTitulo}${numero}-0` : `${tipoTitulo}${numero}`,
        TipoTitulo: NOMES_TIPO[tipoTitulo][0],
        CategoriaTitulo: NOMES_TIPO[tipoTitulo][1],
        Responsavel: escolher(NOMES),
        Carro: carro,
        Placa: `${letras()}${letras()}${letras()}${Math.floor(aleatorio() * 10)}${letras()}${Math.floor(aleatorio() * 90 + 10)}`,
        CodAcesso: String(100000 + Math.floor(aleatorio() * 900000)),
        Tipo: /CG|Fazer/.test(carro) ? 'Moto' : 'Carro',
        Status: escolher(STATUS),
        DataInclusao: formatarLocal(data),
        Isento: aleatorio() < 0.18 ? 'Sim' : 'Nao'
    };
});

const contem = (valor, termo) => String(valor ?? '').toLowerCase().includes(termo.toLowerCase());

function filtrar(f) {
    return DADOS.filter(v =>
        (!f.tipoTitulo || v.TipoTitulo === f.tipoTitulo) &&
        (!f.categoria || v.CategoriaTitulo === f.categoria) &&
        (!f.titulo || contem(v.Titulo, f.titulo)) &&
        (!f.tipo || v.Tipo === f.tipo) &&
        (!f.status || v.Status === f.status) &&
        (!f.carro || contem(v.Carro, f.carro)) &&
        (!f.busca || ['Titulo', 'Responsavel', 'Carro', 'Placa'].some(c => contem(v[c], f.busca))) &&
        (!f.de || v.DataInclusao.slice(0, 10) >= f.de) &&
        (!f.ate || v.DataInclusao.slice(0, 10) <= f.ate)
    );
}

const CAMPO = {
    titulo: 'Titulo', tipotitulo: 'TipoTitulo', categoria: 'CategoriaTitulo', responsavel: 'Responsavel', carro: 'Carro', placa: 'Placa',
    codacesso: 'CodAcesso', tipo: 'Tipo', status: 'Status', data: 'DataInclusao', isento: 'Isento'
};

async function listar(f, { pagina, tamanho, ordenar, direcao }) {
    const campo = CAMPO[ordenar] || 'DataInclusao';
    const sinal = direcao === 'asc' ? 1 : -1;
    const lista = filtrar(f).sort((a, b) => String(a[campo]).localeCompare(String(b[campo]), 'pt-BR') * sinal);
    return { linhas: lista.slice((pagina - 1) * tamanho, pagina * tamanho), total: lista.length };
}

async function todos(f) {
    return filtrar(f);
}

async function resumo(f) {
    const lista = filtrar(f);
    const diasAtras = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
    const hojeIso = formatarLocal(new Date()).slice(0, 10);
    return {
        total: lista.length,
        hoje: lista.filter(v => v.DataInclusao.slice(0, 10) === hojeIso).length,
        semana: lista.filter(v => v.DataInclusao >= formatarLocal(diasAtras(7))).length,
        mes: lista.filter(v => v.DataInclusao >= formatarLocal(diasAtras(30))).length,
        isentos: lista.filter(v => v.Isento === 'Sim').length
    };
}

async function agrupar(por, f, limite) {
    const chave = {
        tipoTitulo: v => v.TipoTitulo, categoria: v => v.CategoriaTitulo, titulo: v => v.Titulo, carro: v => v.Carro, tipo: v => v.Tipo, status: v => v.Status,
        dia: v => v.DataInclusao.slice(0, 10), mes: v => v.DataInclusao.slice(0, 7), ano: v => v.DataInclusao.slice(0, 4)
    }[por];
    const mapa = new Map();
    filtrar(f).forEach(v => { const k = chave(v) ?? '(vazio)'; mapa.set(k, (mapa.get(k) || 0) + 1); });
    const itens = [...mapa].map(([rotulo, total]) => ({ rotulo, total }));
    return ['dia', 'mes', 'ano'].includes(por)
        ? itens.sort((a, b) => a.rotulo.localeCompare(b.rotulo))
        : itens.sort((a, b) => b.total - a.total).slice(0, limite);
}

async function opcoes() {
    const contagem = new Map();
    DADOS.forEach(v => contagem.set(v.TipoTitulo, (contagem.get(v.TipoTitulo) || 0) + 1));
    return {
        tiposTitulo: [...contagem].map(([valor, total]) => ({ valor, total })).sort((a, b) => b.total - a.total),
        categorias: [...new Set(DADOS.map(v => v.CategoriaTitulo))].sort(),
        tipos: [...new Set(DADOS.map(v => v.Tipo))].sort(),
        status: [...new Set(DADOS.map(v => v.Status).filter(Boolean))].sort()
    };
}

async function saude() { }

module.exports = { listar, todos, resumo, agrupar, opcoes, saude, AGRUPAMENTOS };

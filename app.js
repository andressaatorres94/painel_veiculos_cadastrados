function carregarVeiculos(){
    const veiculos = [
        {
            titulo: '1001',
            responsavel: 'João',
            carro: 'Corolla',
            placa: 'ABC1234',
            tipo: 'Carro',
            status: 'Ativo',
            data: '08/05/2026 14:00'
        },
        {
            titulo: '1002',
            responsavel: 'Maria',
            carro: 'Civic',
            placa: 'XYZ9876',
            tipo: 'Carro',
            status: 'Ativo',
            data: '08/05/2026 14:10'

        }

    ];

    // Pega o tbody da tabela

    const tabela = document.getElementById('tabela-veiculos');

    // Limpa a tabela antes de inserir novamente

    tabela.innerHTML = '';

    //Percorre cada veiculo
    veiculos.forEach(veiculo =>{

        //adiconaa uma linha nova
        tabela.innerHTML += `
            <tr>
                <td>${veiculo.titulo}</td>
                <td>${veiculo.responsavel}</td>
                <td>${veiculo.carro}</td>
                <td>${veiculo.placa}</td>
                <td>${veiculo.tipo}</td>
                <td>${veiculo.status}</td>
                <td>${veiculo.data}</td>
            </tr>
        `;
    });
}

carregarVeiculos();
async function carregarVeiculos(){
    
    try {
        const resposta = 
            await fetch(
                'http://localhost:3000/veiculos'
            );
        
        const veiculos = 
            await resposta.json();
        
        const tabela = 
            document.getElementById(
                'tabela-veiculos'
            );
        
            tabela.innerHTML='';

        veiculos.forEach(
            veiculo => {
                tabela.innerHTML += `
                    <tr>

                        <td>
                            ${veiculo.titulo}
                        </td>

                        <td>
                            ${veiculo.responsavel}
                        </td>

                        <td>
                            ${veiculo.carro}
                        </td>

                        <td>
                            ${veiculo.placa}
                        </td>

                    </tr>
                `;
            }
            
        );
    }
    catch (erro){
        console.log (
            erro
        );
    }
}

carregarVeiculos();



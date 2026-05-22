const express = require ('express');
const cors  = require('cors');
const sql = require ('mssql');

const app = express();

app.use(cors());

//configuração SQL server

const config = {
    user: '<removido>',
    password: '<removido>',
    server: '<removido>',
    database: '<removido>',

    option: {
        trustServerCertificate: true
    }
};

//Rota veiculos
app.get ('/veiculos',
    async(req, res) => {
        try {
            //Conecta no SQL
            await sql.connect (
                config
            );
            //Exececuta query
            const resultado = 
                await sql.query (`
                    select top 20
                        titles.code as titulo,
                        cars.responsible as responsavel, 
                        cars.model as carro, 
                        cars plate as placa, 
                        cars.barcode as codAcesso,

                        case 
                            when cars.type = 0
                            then 'carro'

                            whern cars.type = 0
                            then 'moto'

                        end as tipo,

                        case
                            when cars.status = 0
                            then 'ativo'

                            when cars.status = 1
                            then 'desativado'
                        end as status, 

                        format (
                            cars.creationDate,
                            'dd/MM/yyyy HH:mm'
                        ) as dataInclusao
                    from Titles
                    
                    join Cars 
                    on titles.id = 
                    cars.title

                    order by
                    cars.creationDate desc
                    
                    `);
                    //Retorna JSON
                    res.json(
                        resultado.recordset
                    );
        }
        catch (erro){
            console.log(erro);
            
            res.status (500).send(
                erro.message
            );
        }

    }
);

//inicia servidor

app.listen(3000,() => [
    console.log('Servidor rodando na porta 3000')

]);


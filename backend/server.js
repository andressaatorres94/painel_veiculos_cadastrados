const express = require ('express');
const cors  = require('cors');

const app = express();

app.use(cors());

app.get('/veiculos', (req, res)=> {
    
    const veiculos = [{
        titulo: '1001',
        responsavel: 'João',
        carro: 'Corolla',
        placa:'ABC1234'
    
    }];
    
    res.json(veiculos);

});

app.listen(3000,() => [
    console.log('Servidor rodando na porta 3000')

]);


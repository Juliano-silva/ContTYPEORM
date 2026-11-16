import { faker } from '@faker-js/faker/locale/pt_BR';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

interface ColunaInfo {
    decorador: string;
    tipoBanco: string;
    nomeColuna: string;
    propriedade: string;
    nullable: boolean;
    opcional: boolean;
    tipoTypeScript: string;
    length: number | null;
    unique: boolean;
}

function DicionarioEntidade(entidade: string): ColunaInfo[] {
    const regex = /@(\w+)\s*\(([^()]*)\)\s*(\w+)([!?]?)\s*:\s*([\w<>\[\]]+)\s*;/g;
    const decoradoresSuportados = ['PrimaryGeneratedColumn', 'Column', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn'];

    const dicionario: ColunaInfo[] = [];

    for (const match of entidade.matchAll(regex)) {
        const [, decorador, args, propriedade, opcional, tipoTypeScript] = match;

        if (!decoradoresSuportados.includes(decorador)) {
            continue;
        }

        const corpo = args.trim();
        const ehOpcional = opcional === '?';

        const coluna: ColunaInfo = {
            decorador,
            tipoBanco: 'varchar',
            nomeColuna: propriedade,
            propriedade,
            nullable: ehOpcional,
            opcional: ehOpcional,
            tipoTypeScript,
            length: null,
            unique: false,
        };

        if (corpo.startsWith('{')) {
            const tipo = corpo.match(/type:\s*["']([^"']+)["']/);
            const nome = corpo.match(/name:\s*["']([^"']+)["']/);
            const nullable = corpo.match(/nullable:\s*(true|false)/);
            const length = corpo.match(/length:\s*(\d+)/);
            const unique = corpo.match(/unique:\s*(true|false)/);

            if (tipo) coluna.tipoBanco = tipo[1];
            if (nome) coluna.nomeColuna = nome[1];
            if (nullable) coluna.nullable = nullable[1] === 'true';
            if (length) coluna.length = Number(length[1]);
            if (unique) coluna.unique = unique[1] === 'true';
        } else {
            const strategy = corpo.replace(/["']/g, '').trim();
            coluna.tipoBanco = strategy || 'integer';
        }

        if (['CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn'].includes(decorador)) {
            coluna.tipoBanco = 'timestamp with time zone';
        }

        if (decorador === 'CreateDateColumn' || decorador === 'UpdateDateColumn') {
            coluna.nullable = false;
        }

        dicionario.push(coluna);
    }

    return dicionario;
}

function normalizar(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}


function gerarCnpj(mascara: boolean): string {
    const n = () => faker.number.int({ min: 0, max: 9 });
    const base = Array.from({ length: 12 }, n);

    const digito = (nums: number[], pesos: number[]) => {
        const soma = nums.reduce((acc, num, i) => acc + num * pesos[i], 0);
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };

    const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = digito([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const nums = [...base, d1, d2].join('');

    return mascara
        ? `${nums.slice(0, 2)}.${nums.slice(2, 5)}.${nums.slice(5, 8)}/${nums.slice(8, 12)}-${nums.slice(12)}`
        : nums;
}

function gerarCpf(mascara: boolean): string {
    const n = () => faker.number.int({ min: 0, max: 9 });
    const base = Array.from({ length: 9 }, n);

    const digito = (nums: number[], pesoInicial: number) => {
        const soma = nums.reduce((acc, num, i) => acc + num * (pesoInicial - i), 0);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };

    const d1 = digito(base, 10);
    const d2 = digito([...base, d1], 11);
    const nums = [...base, d1, d2].join('');

    return mascara
        ? `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6, 9)}-${nums.slice(9)}`
        : nums;
}

function ajustarLength(valor: string, length: number | null): string {
    return length !== null && valor.length > length ? valor.slice(0, length) : valor;
}

// o padrão Strategy + regras de geração
type RegraGeracao = {
    condicao: () => boolean;
    gerar: () => unknown;
};

function gerarValor(coluna: ColunaInfo): unknown {
    const tipoTS = coluna.tipoTypeScript.toLowerCase();
    const tipoBanco = coluna.tipoBanco.toLowerCase();

    const base = normalizar(`${coluna.propriedade} ${coluna.nomeColuna}`);
    const palavras = new Set(base.split(' '));

    const tem = (...chaves: string[]) =>
        chaves.some(chave => base.includes(chave));

    // Decorators especiais
    const decorators: Record<string, () => unknown> = {
        CreateDateColumn: () => faker.date.recent().toISOString(),
        UpdateDateColumn: () => faker.date.recent().toISOString(),
        DeleteDateColumn: () => null
    };

    if (decorators[coluna.decorador]) {
        return decorators[coluna.decorador]();
    }

    // Nullable
    if (
        coluna.nullable &&
        faker.number.int({ min: 1, max: 100 }) <= 15
    ) {
        return null;
    }

    const regras: RegraGeracao[] = [
        {
            condicao: () => palavras.has('id') || tipoBanco.includes('uuid'),
            gerar: () => faker.string.uuid()
        },
        {
            condicao: () => tem('cnpj'),
            gerar: () => gerarCnpj(coluna.length === null || coluna.length >= 18)
        },
        {
            condicao: () => tem('cpf'),
            gerar: () => gerarCpf(coluna.length === null || coluna.length >= 14)
        },
        {
            condicao: () => tem('email', 'e mail'),
            gerar: () => faker.internet.email().toLowerCase()
        },
        {
            condicao: () => tem('telefone', 'celular', 'whatsapp', 'fone'),
            gerar: () => faker.phone.number()
        },
        {
            condicao: () => tem('site', 'website', 'url', 'dominio', 'link'),
            gerar: () => `https://www.${faker.internet.domainName()}`
        },
        {
            condicao: () => tem('razao social', 'razaosocial', 'razao'),
            gerar: () => `${faker.company.name()} ${faker.helpers.arrayElement(['Ltda', 'S/A', 'ME', 'EPP'])}`
        },
        {
            condicao: () => tem('nome fantasia', 'nomefantasia', 'fantasia'),
            gerar: () => faker.company.name()
        },
        {
            condicao: () => tem('descricao', 'observacao', 'obs', 'bio', 'detalhes'),
            gerar: () => faker.lorem.sentence()
        },
        {
            condicao: () => tem('cargo', 'funcao'),
            gerar: () => faker.helpers.arrayElement([
                'Administrador', 'Gerente', 'Analista',
                'Desenvolvedor', 'Suporte', 'Diretor',
                'Coordenador', 'Estagiário'
            ])
        },
        {
            condicao: () => palavras.has('nivel'),
            gerar: () => faker.number.int({ min: 1, max: 10 })
        },
        {
            condicao: () => tem('permissao', 'role', 'papel', 'perfil'),
            gerar: () => faker.helpers.arrayElement([
                'gerenciar', 'visualizar', 'editar', 'excluir'
            ])
        },
        {
            condicao: () => tem('status', 'situacao'),
            gerar: () => faker.helpers.arrayElement([
                'ativo', 'inativo', 'pendente'
            ])
        },
        {
            condicao: () => tem('cep'),
            gerar: () => faker.location.zipCode()
        },
        {
            condicao: () => tem('logradouro', 'endereco'),
            gerar: () => faker.location.streetAddress()
        },
        {
            condicao: () => palavras.has('numero') || palavras.has('nro'),
            gerar: () => faker.number.int({ min: 1, max: 9999 })
        },
        {
            condicao: () => tem('complemento', 'apto', 'sala'),
            gerar: () => faker.helpers.arrayElement([
                'Sala 12', 'Bloco B', 'Apto 34', 'Casa 2'
            ])
        },
        {
            condicao: () => tem('bairro'),
            gerar: () => faker.helpers.arrayElement([
                'Centro', 'Jardins', 'Vila Nova',
                'Bela Vista', 'Santa Cruz'
            ])
        },
        {
            condicao: () => tem('cidade', 'municipio'),
            gerar: () => faker.location.city()
        },
        {
            condicao: () => tem('estado', 'uf'),
            gerar: () => faker.location.state({ abbreviated: true })
        },
        {
            condicao: () => tem('pais'),
            gerar: () => 'Brasil'
        },
        {
            condicao: () => tem('username', 'login', 'usuario'),
            gerar: () => faker.internet.username().toLowerCase()
        },
        {
            condicao: () => tem('senha', 'password'),
            gerar: () => faker.internet.password({ length: 12 })
        },
        {
            condicao: () => tem('salario', 'valor', 'preco', 'total', 'montante', 'vlr', 'custo', 'taxa'),
            gerar: () => faker.number.float({
                min: 10, max: 50000, fractionDigits: 2
            })
        },
        {
            condicao: () => tem('data', 'date', 'nascimento', 'aniversario'),
            gerar: () => faker.date.past().toISOString()
        },
        {
            condicao: () => tem('empresa'),
            gerar: () => faker.company.name()
        },
        {
            condicao: () => tem('produto', 'item'),
            gerar: () => faker.commerce.productName()
        },
        {
            condicao: () => tem('nome'),
            gerar: () => faker.person.fullName()
        },
        {
            condicao: () => tipoTS === 'number',
            gerar: () => /int|bigint|smallint|serial/.test(tipoBanco)
                ? faker.number.int({ min: 1, max: 100000 })
                : faker.number.float({ min: 1, max: 10000, fractionDigits: 2 })
        },
        {
            condicao: () => tipoTS === 'boolean',
            gerar: () => faker.datatype.boolean()
        },
        {
            condicao: () => tipoTS === 'date',
            gerar: () => faker.date.recent().toISOString()
        },
        {
            condicao: () => /json|jsonb/.test(tipoBanco),
            gerar: () => ({
                chave: faker.lorem.word(),
                valor: faker.lorem.words(2)
            })
        },
        {
            condicao: () => tipoBanco === 'text',
            gerar: () => faker.lorem.paragraph()
        }
    ];

    const regra = regras.find(regra => regra.condicao());

    let valor = regra
        ? regra.gerar()
        : faker.lorem.words(3);

    if (tipoTS === 'string' && typeof valor === 'string') {
        valor = ajustarLength(valor, coluna.length);
    }

    return valor;
}

const Entidade_Arquivo = "entrada.txt"
const caminhoEntrada = path.join(process.cwd(), Entidade_Arquivo);

rl.question('Digite a quantidade de registros a serem gerados: ', (resposta) => {
    const quantidade = parseInt(resposta.trim());
    fs.readFile(caminhoEntrada, 'utf8', (err, data) => {
        if (err) {
            console.error('Erro ao ler o arquivo:', err);
            return;
        }

        const dicionario = DicionarioEntidade(data);

        const resultado: Record<string, unknown> = {};
        for (var i = 0; i < quantidade; i++) {
            const registro: Record<string, unknown> = {};
            for (const coluna of dicionario) {
                registro[coluna.propriedade] = gerarValor(coluna);
            }
            resultado[`registro_${i + 1}`] = registro;
        }

        const nomeArquivo = 'saida.json';
        const caminhoSaida = path.join(process.cwd(), nomeArquivo);

        fs.writeFileSync(caminhoSaida, JSON.stringify(resultado, null, 2) + '\n', 'utf8');

        console.log(JSON.stringify(resultado, null, 2));
        console.log(`\nArquivo salvo em: ${caminhoSaida}`);
    });
})
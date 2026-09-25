import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRADUCAO_DO_MOVIMENTO,
  ondeEstaAgora,
  traduzirMovimento,
} from './linguagem-do-processo.util';
import { CAMPOS_DO_CADASTRO_PELO_LINK } from '../recadastramento/dto/recadastro-publico.dto';
import { CAMPOS_QUE_O_FILIADO_EDITA } from './portal-filiado.service';

/** O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica. */
const semComentario = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "TÁ BOM DA FORMA QUE ESTÁ SENDO MOSTRADO AO FILIADO LEIGO?" — o dono,
 * 25/09/2026, olhando a ficha do processo no portal.
 *
 * NÃO ESTAVA. O portal despejava a Tabela Processual Unificada do CNJ, crua.
 * MEDIDO em 20.590 movimentações da produção: "Mero expediente" (926 vezes),
 * "de Instrução" (186) e "de Conciliação" (114) — as duas últimas **nem são
 * frases**, são complementos da TPU que chegam soltos.
 *
 * As 25 descrições mais comuns cobrem 91,4% de tudo.
 */
describe('o processo em português', () => {
  it('traduz os fragmentos que não eram frase', () => {
    expect(traduzirMovimento(12749, 'de Instrução').titulo).toBe('Audiência de instrução');
    expect(traduzirMovimento(12740, 'de Conciliação').titulo).toBe('Audiência de conciliação');
    expect(traduzirMovimento(11010, 'Mero expediente').titulo).toBe('Despacho de andamento');
  });

  /**
   * SÓ TRADUZ O QUE EU SEI. Código fora do dicionário mantém o texto do
   * tribunal, palavra por palavra. Tradução errada é pior que jargão: o jargão
   * a pessoa sabe que não entendeu e liga; a frase errada em português ela
   * entende — errado — e vai embora.
   */
  it('o que não está no dicionário sai como o tribunal escreveu', () => {
    const m = traduzirMovimento(999999, 'Expedição de carta precatória');
    expect(m.titulo).toBe('Expedição de carta precatória');
    expect(m.traduzido).toBe(false);
    expect(traduzirMovimento(null, 'Sem código').titulo).toBe('Sem código');
  });

  /** E desconhecido NÃO é trâmite: o que cair ali amanhã pode ser uma sentença. */
  it('desconhecido não é escondido por padrão', () => {
    expect(traduzirMovimento(999999, 'Qualquer coisa').peso).not.toBe('TRAMITE');
  });

  /** O texto do TRIBUNAL viaja sempre: é o que o advogado lê no sistema do TRT. */
  it('o original nunca se perde', () => {
    expect(traduzirMovimento(11010, 'Mero expediente').original).toBe('Mero expediente');
  });

  /**
   * NUNCA PROMETE DESFECHO. O mesmo movimento pode se referir a um embargo, a
   * um incidente ou a parte dos pedidos — quem lê o caso é o advogado.
   */
  it('não diz "você ganhou"', () => {
    const fonte = semComentario('./linguagem-do-processo.util.ts');
    for (const proibido of ['você ganhou', 'você perdeu', 'vitória', 'derrota']) {
      expect(fonte.toLowerCase()).not.toContain(proibido);
    }
    expect(TRADUCAO_DO_MOVIMENTO[219].titulo).toBe('Pedido julgado procedente');
  });

  /** O dicionário não pode encolher sem alguém perceber. */
  it('cobre os códigos que respondem por 91% do acervo', () => {
    for (const codigo of [85, 60, 51, 92, 1061, 1051, 11010, 26, 123, 12115]) {
      expect(TRADUCAO_DO_MOVIMENTO[codigo]).toBeDefined();
    }
  });
});

/**
 * ONDE ESTÁ AGORA — a primeira coisa que alguém quer saber, e a que a linha do
 * tempo não responde: ela conta a história de trás para a frente e exige ler
 * três itens para montar o presente.
 */
describe('onde o processo está agora', () => {
  const em = (dia: number) => new Date(Date.UTC(2026, 8, dia));

  it('pula o trâmite e pega o último movimento que significa algo', () => {
    const r = ondeEstaAgora([
      { codigoMovimento: 123, descricao: 'Remessa', dataMovimento: em(20) },
      { codigoMovimento: 132, descricao: 'Recebimento', dataMovimento: em(19) },
      { codigoMovimento: 12749, descricao: 'de Instrução', dataMovimento: em(10) },
    ]);
    expect(r?.titulo).toBe('Audiência de instrução');
    expect(r?.em).toEqual(em(10));
  });

  /** Só trâmite = não diz nada. "Seu processo foi recebido pelo setor" é ruído. */
  it('cala quando só houve máquina do tribunal andando', () => {
    expect(
      ondeEstaAgora([{ codigoMovimento: 123, descricao: 'Remessa', dataMovimento: em(20) }]),
    ).toBeNull();
    expect(ondeEstaAgora([])).toBeNull();
  });
});

/**
 * "EXISTE ALGO QUE O ADVOGADO PODE COLOCAR PARA COMUNICAR ALGO AO FILIADO PELO
 * PORTAL?" — não existia, e o buraco era grande: o portal mostrava o que o
 * TRIBUNAL publicou e nada do que o sindicato tem a dizer sobre aquilo.
 */
describe('o recado do sindicato', () => {
  const servico = semComentario('./portal-filiado.service.ts');

  it('é marcado como visto ao ABRIR, não num botão', () => {
    expect(servico).toContain('const naoVistos = p.recados.filter((r) => !r.vistoEm)');
    expect(servico).toContain('data: { vistoEm: new Date() }');
  });

  /** Falhar o carimbo não pode derrubar a ficha: o recado continua na tela. */
  it('falhar o carimbo não derruba a ficha', () => {
    const trecho = servico.slice(servico.indexOf('const naoVistos'));
    expect(trecho.slice(0, 400)).toContain('.catch(() => null)');
  });

  it('a home e a lista contam os não lidos', () => {
    expect(servico).toContain('private contarRecadosNovos(filiadoId: string)');
    expect(servico).toContain('_count: { select: { recados: { where: { vistoEm: null } } } },');
  });

  /**
   * NÃO É A NOTA INTERNA. `MovimentacaoInterna` é a conversa da EQUIPE e nunca
   * sai do sistema — se ela aparecer neste serviço, estratégia processual vai
   * parar no celular da parte contrária pelas mãos do próprio cliente.
   */
  it('nunca serve a nota interna', () => {
    expect(servico).not.toContain('movimentacoesInternas');
  });
});

/**
 * "AQUI NÃO ERA PRA SER POSSÍVEL O FILIADO FAZER UM RECADASTRAMENTO SE QUISER?
 * BOTAR UMA FOTO DE PERFIL?" — era, e não era.
 *
 * O portal deixava mexer em dez campos (endereço e contato) enquanto o link
 * mandado por WhatsApp deixava atualizar o cadastro inteiro. Duas portas para a
 * mesma pessoa, com regras diferentes — e a mais completa era a que exigia
 * alguém lembrar de enviar.
 */
describe('o recadastramento pelo portal', () => {
  const servico = semComentario('./portal-filiado.service.ts');

  /** NÃO EXISTE UMA SEGUNDA LISTA: é a mesma constante do link. */
  it('permite exatamente os campos do link', () => {
    expect(CAMPOS_QUE_O_FILIADO_EDITA).toBe(CAMPOS_DO_CADASTRO_PELO_LINK);
    expect(CAMPOS_QUE_O_FILIADO_EDITA).toContain('nomeCompleto');
    expect(CAMPOS_QUE_O_FILIADO_EDITA).toContain('dataNascimento');
    expect(CAMPOS_QUE_O_FILIADO_EDITA).not.toContain('situacao');
    expect(CAMPOS_QUE_O_FILIADO_EDITA).not.toContain('matricula');
  });

  /** E usa os MESMOS filtros do link — defesa em profundidade, não confiança. */
  it('filtra pelo mesmo `camposDoLink` e herda o vinculo com `vinculosPeloLink`', () => {
    expect(servico).toContain('camposDoLink(dto as unknown as Record<string, unknown>)');
    expect(servico).toContain('vinculosPeloLink(dto.vinculos ?? [], antes.vinculos)');
  });

  /**
   * E UM RECADASTRAMENTO, e entra no historico como tal. Gravar so o
   * `filiado.update` deixaria a mudanca invisivel: a secretaria veria os dados
   * novos sem saber de onde vieram nem o que havia antes.
   */
  it('registra o de-para, como o link faz', () => {
    expect(servico).toContain('this.prisma.recadastramento.create(');
    expect(servico).toContain('TipoHistoricoFiliado.RECADASTRAMENTO');
  });

  /** A foto passa pelo MESMO processamento da equipe - recorte e miniatura. */
  it('a foto reaproveita o servico de filiados', () => {
    expect(servico).toContain('this.filiados.atualizarFoto(');
    expect(servico).not.toContain('processarFoto(');
  });
});

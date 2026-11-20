# Como o EMERGENCE funciona

## A pergunta

**Como comportamentos sociais complexos podem surgir das interações entre agentes relativamente simples?**

O projeto foi construído em torno de um princípio: *poucos mecanismos bem feitos que interagem*, em vez de muitos
recursos superficiais. Nenhum evento é roteirizado. O que acontece depende das regras locais, da personalidade e da
história de cada indivíduo.

## O mundo (`src/sim/world.ts`)

- Mapa de 84 × 56 células gerado por ruído: lagos, areia, campo, floresta, montanhas.
- **Arbustos de frutas** (comida) crescem conforme fertilidade, chuva e estação. **Florestas** dão lenha.
- **Estações**: primavera, verão, outono e inverno (1 ano = 32 dias; 1 dia = 100 passos). No inverno quase nada
  cresce e o frio exige **abrigo com lenha**. É a crise anual — a sociedade precisa se preparar.
- **Lençol freático**: segue a chuva lentamente; numa seca, lagos rasos secam (viram lama rachada, transitável).
- **Fogo** se espalha por floresta e campo; cinzas aumentam a fertilidade depois.
- A capacidade total de comida é normalizada entre sementes, para que mapas sejam comparáveis.

## O indivíduo (`src/sim/agent.ts`)

| Componente | Conteúdo |
|---|---|
| Necessidades | fome, sede, cansaço, frio, solidão, saúde |
| Personalidade | generosidade, ousadia, curiosidade, sociabilidade, diligência (herdadas com mutação) |
| Memória espacial | locais de comida, lenha e água **que ele viu ou ouviu falar** — não há conhecimento global |
| Relações | confiança (−1…1), familiaridade, quanto recebeu, quanto lhe roubaram, quanto deu |
| Visão de mundo | confiança em estranhos, moldada por experiências |
| Aprendizado | valor esperado de cada estratégia (coletar, explorar, cortar lenha, conversar, doar, pedir, roubar, trocar, estocar) |
| Habilidades | coleta, lenha, construção — melhoram com a prática |
| Diário | memórias marcantes com carga emocional |

## A decisão (`src/sim/brain.ts`)

Arquitetura de **utilidade com aprendizado** (bandit por agente):

1. Cada ação possível recebe uma pontuação, soma de **fatores nomeados** (ex.: "Fome +0,41", "Testemunhas −0,14",
   "Rancor de Kiro +0,22").
2. Ações estratégicas são multiplicadas por um valor **aprendido** com os resultados de tentativas anteriores
   (`q ← q + α·(recompensa − q)`; α depende da curiosidade). Valores esquecem devagar, permitindo re-tentar.
3. Um pouco de ruído torna a escolha "suave" — agentes não são perfeitamente racionais.

Como cada fator tem um rótulo, a interface mostra **por que** o agente escolheu aquilo, e quais alternativas
perdeu. Esse é o motivo principal de **não usar LLMs**: uma LLM local seria lenta demais para 50 agentes tomando
decisões várias vezes por segundo num notebook, não é reproduzível com semente, e suas "justificativas" seriam
narrativas, não a causa real da decisão. Aqui a explicação **é** o cálculo.

### Interações sociais (`src/sim/sim.ts`)

- **Conversar**: aumenta a confiança (com retornos decrescentes), troca **locais de comida** e **fofoca**
  (o falante passa sua opinião mais forte sobre um terceiro; o ouvinte ajusta na proporção em que confia no falante).
- **Doar / pedir**: quem recebe passa a confiar mais; testemunhas também melhoram a opinião sobre o doador.
  Se alguém ajudado antes devolve a ajuda, o doador original aprende que doar compensou (**reciprocidade**).
- **Trocar**: escambo comida ↔ lenha, só quando ambos se beneficiam.
- **Roubar** (pessoas ou estoques): vítima e testemunhas podem perceber; a confiança despenca e a informação se
  espalha. Vítimas ousadas confrontam; **testemunhas podem punir** o ladrão em defesa da vítima.
- **Competição**: chegar a um local de comida esvaziado gera ressentimento contra quem está colhendo ali.
- **Lares**: quem tem abrigo pode acolher alguém de confiança mútua alta. **Família**: pares com vínculo forte e bem
  alimentados têm filhos, que herdam traços (com mutação), parte do aprendizado, a visão de mundo e o conhecimento
  dos pais (**transmissão cultural**).
- **Doença**: contágio por proximidade (mais ao conversar).

## O que é regra e o que é emergente

| Programado (regras locais) | Emergente (não está em nenhuma regra) |
|---|---|
| Necessidades, estações, crescimento das plantas | Quem fica amigo de quem; **grupos** (são *medidos* na rede de confiança, nunca atribuídos) |
| O efeito imediato de cada ação | Ciclo anual de desigualdade (Gini sobe no inverno e cai na primavera) |
| Como a confiança muda após cada interação | Indivíduos que "aprendem" a roubar e outros que desistem |
| Fórmulas de pontuação das ações | Má reputação espalhada para quem nunca foi vítima |
| | Especialização (lenhadores × coletores), lares entre não-parentes, colapso após seca + inverno |

Os **padrões detectados** no painel Sociedade (`src/sim/insights.ts`) apenas medem; nunca alteram a simulação.

## Ciência: como distinguir emergência de imposição

1. **Reprodutibilidade**: tudo vem de um gerador pseudoaleatório com semente. Mesma semente = mesma história
   (verificado por teste automatizado).
2. **Repetição**: o Laboratório roda várias sementes por condição e reporta média ± desvio.
3. **Ablação**: desligar um mecanismo (aprendizado, fofoca, compartilhamento de conhecimento) e medir o efeito.
   Se um padrão desaparece sem o mecanismo, ele depende dele; se persiste, não.
4. **Honestidade estatística**: estatística *t* de Welch; resultados nulos são exibidos como tais.

## Limitações

- É um **modelo**, não uma sociedade humana. Os resultados mostram consequências *das regras escolhidas*;
  extrapolar para pessoas reais exige cautela.
- Os parâmetros (taxas de fome, valores de recompensa etc.) foram calibrados à mão para produzir um mundo viável;
  outros valores produziriam outros resultados. As fórmulas embutem hipóteses (ex.: generosidade gera "satisfação" ao doar).
- 30–60 agentes; padrões de larga escala (cidades, mercados, Estado) estão fora de escopo.
- O aprendizado é simples (valor por estratégia), não planejamento de longo prazo.
- Vários resultados têm alta variância entre sementes — o que, em si, é um achado: pequenas diferenças iniciais
  levam a histórias muito diferentes.

## Mapa do código

```
src/sim/      núcleo da simulação (sem DOM; roda no navegador, Worker e Node)
  types.ts    constantes, ações, configuração
  rng.ts      gerador com semente e ruído
  world.ts    terreno, plantas, água, fogo, pathfinding
  agent.ts    estado do indivíduo
  brain.ts    decisão por utilidade + aprendizado
  sim.ts      laço principal, interações, métricas, intervenções
  social.ts   detecção de grupos, Gini
  insights.ts detectores de padrões (só medem)
  experiment.ts experimentos em lote
src/ui/       interface (renderer em Canvas, painéis, gráficos, laboratório)
scripts/      testes e experimentos por linha de comando
```

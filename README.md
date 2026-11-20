# EMERGENCE — Artificial Society Experiment

> Um pequeno mundo habitado por indivíduos artificiais. Ninguém escreveu a história deles.

Projeto para a **Expo Tech Insper 2026**. Uma simulação interativa de uma sociedade de agentes autônomos que
têm necessidades, personalidade, memória, relações e **aprendem com a própria experiência**. Amizades, grupos,
desigualdade, roubo, punição, lares compartilhados e especialização **não são programados** — surgem (ou não) das
interações. O visitante observa de cima, clica em qualquer indivíduo para entender **por que** ele tomou cada
decisão, e pode intervir: seca, incêndio, doença, plantar comida, introduzir um oportunista, mudar a personalidade
de alguém. Um **Laboratório** roda experimentos controlados com várias repetições e compara condições.

## Como abrir (sem instalar nada)

Baixe o arquivo **`EMERGENCE.html`** deste repositório e dê dois cliques. Funciona offline, em qualquer navegador
moderno (Chrome, Edge, Firefox). É tudo o que precisa para apresentar.

## Como rodar a partir do código

Requer [Node.js](https://nodejs.org) 20 ou superior.

```bash
npm install
```

```bash
npm run dev
```

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run build` | Gera `dist/index.html` e atualiza `EMERGENCE.html` (arquivo único, offline) |
| `npm test` | Testes do motor (determinismo, ausência de NaN, intervenções, ablações) |
| `npm run experiment` | Lista os experimentos de linha de comando |
| `npm run experiment -- learning 8 96` | Roda um experimento (8 sementes, 96 dias), imprime tabela e salva CSV em `results/` |

## Usando o EMERGENCE

- **Observar**: clique em um indivíduo. O painel mostra o que ele faz agora, as opções que considerou com a
  pontuação de cada uma e os **fatores** por trás (fome, confiança, ganância, testemunhas…), as estratégias que
  aprendeu, relações, memórias e histórico. Sem seleção, o painel sugere indivíduos notáveis.
- **Sociedade**: indicadores, **padrões detectados automaticamente** (com evidências), grupos emergentes,
  causas de morte.
- **Intervir**: barra à esquerda (plantar, dádiva, desmatar, floresta, água, fogo, novo indivíduo, doença, seca,
  chuvas, inverno rigoroso). Toda intervenção aparece como linha tracejada nos gráficos.
- **Laboratório**: experimentos controlados em segundo plano, com média ± desvio e estatística *t*.
- **Novo mundo**: semente, população, abundância e **ablação** de mecanismos (aprendizado, fofoca,
  compartilhar locais, reprodução). **↺ Mesma semente** repete exatamente a mesma história.
- **Visão 3D ou mapa**: o mundo abre em 3D (dia e noite, estações, chuva, neve, fogo, casas iluminadas à noite).
  Arraste para mover, roda para zoom, botão direito (ou Shift + arrastar) para girar. `V` alterna para o mapa 2D.
- **Modo vitrine**: após 2 minutos sem interação, a tela de abertura volta com a câmera orbitando.
- Atalhos: `Espaço` pausa · `1`–`4` velocidade · `V` 3D/mapa · `F` seguir · `R` recentralizar · `Esc` limpar.

## Documentação

- [`docs/COMO_FUNCIONA.md`](docs/COMO_FUNCIONA.md) — arquitetura, mecanismos, o que é regra e o que é emergente, limitações.
- [`docs/RESULTADOS.md`](docs/RESULTADOS.md) — experimentos executados e o que mostraram.
- [`docs/APRESENTACAO.md`](docs/APRESENTACAO.md) — roteiro para a Expo e respostas para perguntas frequentes.
- [`docs/PROMPT_MELHORIAS.md`](docs/PROMPT_MELHORIAS.md) — próximas melhorias visuais (prompt pronto) e ferramentas recomendadas.

## Tecnologias

TypeScript, three.js (visão 3D) e Canvas 2D (mapa), Vite (empacotado em um único HTML, com fontes embutidas), Web Worker para o laboratório. Sem servidor, sem
custo, sem modelos de linguagem: as decisões vêm de uma arquitetura de utilidade transparente com aprendizado por
reforço simples (veja o porquê em `docs/COMO_FUNCIONA.md`). Roda folgado em notebook comum (~0,4 ms por passo com
50 agentes).

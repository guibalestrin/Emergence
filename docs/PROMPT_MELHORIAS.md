# EMERGENCE: melhorias visuais (3D, animação, menos cara de IA)

## 1. Diagnóstico (antes desta rodada)

| Ponto | Como estava | Por que pesava |
|---|---|---|
| Mundo | Mapa 2D de quadradinhos visto de cima | Plano, parecia um protótipo; difícil "vender" em 5 segundos num estande |
| Tipografia | Fonte do sistema + mono genérica, logo em caixa-alta espaçada | Visual padrão de dashboard gerado por IA |
| Ícones | Emojis na barra de ferramentas, na intro, nos painéis | Emoji renderiza diferente em cada sistema e é a marca nº 1 de "feito por IA" |
| Intro | Modal com 3 cards iguais (ícone grande, título, texto) | Exatamente o layout que todo gerador de site produz |
| Movimento | Nenhuma animação de interface | Interface parada, sem hierarquia de atenção |
| Barra superior | Data sobrepondo o subtítulo; botões quebrando linha | Bug visual em 1440 px |
| Estande | Nada acontecia se ninguém mexesse | Perde o visitante que só passa olhando |

## 2. O que já foi feito

- **Visão 3D** (`src/ui/renderer3d.ts`, three.js): diorama com relevo por terreno, árvores, arbustos com frutas, casas com
  telhado na cor do grupo, indivíduos que balançam ao andar, anéis de grupo, arcos 3D para doações/trocas/roubos.
- **Dia e noite** com sol que atravessa o céu, lua fria, casas com janela acesa à noite; **estações** (outono laranja,
  inverno com neve e lagos congelados); **chuva** e **neve** com partículas; **fogo** animado; névoa quente na seca.
- **Câmera**: arrastar move, roda dá zoom no cursor, botão direito gira; selecionar alguém faz a câmera voar até ele,
  com feixe de luz e etiqueta flutuante "Nome · o que está fazendo".
- **Mapa 2D** continua disponível (tecla `V`) e é o fallback automático se o WebGL falhar.
- **Identidade**: Instrument Serif + IBM Plex Sans/Mono embutidas (funciona offline), paleta quente, âmbar como único destaque.
- **Ícones de linha** (lucide) no lugar de todos os emojis da interface.
- **Intro editorial** sobre o mundo 3D orbitando, com entrada escalonada; lista numerada 01/02/03 em vez de cards.
- **Animações**: entrada de modais, crônica com eventos novos deslizando (e piscando nos marcos e roubos), botões com resposta ao toque;
  tudo desliga com `prefers-reduced-motion`.
- **Modo vitrine**: 2 min sem interação, a intro volta sozinha com a câmera girando.
- `EMERGENCE.html` continua um arquivo único offline (~1,1 MB).

## 3. Prompt para a próxima rodada

> Cole numa sessão do Claude Code aberta neste repositório. O `CLAUDE.md` já explica arquitetura e regras de design.

```text
Leia CLAUDE.md e docs/PROMPT_MELHORIAS.md. Vamos continuar o polimento visual do EMERGENCE para a Expo,
em fases. Em cada fase: explique em 5 linhas o plano, implemente, rode npm test e npm run build, tire
screenshots com Playwright (1366x768 e 1920x1080; 3D e mapa; dia e noite), me mostre e faça commit.
Regras: o motor em src/sim não muda (os resultados científicos dependem dele), tudo funciona offline
num único HTML de no máximo 2 MB, sem emoji, sem cara de template de IA, respeitando reduced-motion.

Fase A — Personagens com vida
- Indivíduos com cabeça e corpo separados, crianças menores, idosos curvados (idade já existe no Agent).
- Ícone da intenção atual flutuando sobre a cabeça no 3D (sprite gerado de um SVG lucide em CanvasTexture),
  aparecendo só com zoom próximo, como no mapa 2D.
- Animações por ação: cortar lenha (balanço), coletar (abaixar), conversar (virar um para o outro),
  roubar (corrida inclinada), descansar (deitar). Só transformações nas instâncias, sem modelos externos.

Fase B — Pós-processamento leve
- Bloom só para fogo, janelas acesas e o feixe de seleção; vinheta sutil; tudo atrás de um seletor de
  qualidade (Alta / Leve) que detecta FPS < 40 e cai para Leve sozinho.
- Água com leve ondulação (shader simples no plano) e reflexo do céu.

Fase C — Câmera diretora (modo vitrine 2.0)
- No modo vitrine, em vez de só orbitar: a cada 12 s a câmera corta para um acontecimento recente
  (roubo flagrado, nascimento, novo grupo, incêndio), com uma legenda em serifa contando o que houve
  ("Tuzoel roubou de Raloeln. Duas pessoas viram."). Use sim.events e centerOn com tween.

Fase D — Painéis e gráficos com a mesma identidade
- Gráficos do rodapé: números grandes em Instrument Serif, linhas finas, faixas de inverno discretas,
  marcadores de intervenção como linhas verticais rotuladas.
- Painel do indivíduo: retrato 3D pequeno (render do personagem em um canvas próprio) no topo.
- Transição suave ao trocar de indivíduo (fade cruzado), sem animar o redesenho de 250 ms.

Fase E — Som (opcional, desligado por padrão)
- Ambiente gerado com Web Audio (vento, pássaros de dia, grilos à noite, chuva), sem arquivos de áudio.
- Botão de som na barra superior, volume baixo, respeitando a política de autoplay.

Fase F — Tela sensível ao toque (se o estande usar tablet/TV touch)
- Pinça para zoom, dois dedos para girar, toque longo para selecionar; botões com 44 px de área.
```

## 4. Ferramentas e integrações

### Já instaladas neste repositório
| O quê | Para quê | Onde |
|---|---|---|
| **three.js** | Visão 3D | `package.json` |
| **lucide** | Ícones de linha em SVG | `src/ui/icons.ts` |
| **@fontsource** (Instrument Serif, IBM Plex) | Fontes embutidas, sem internet | `src/ui/main.ts` |
| **MCP Context7** | Documentação atual de three.js/Vite para o agente não usar API antiga | `.mcp.json` |
| **MCP Playwright** | O agente abre o app, clica e tira screenshots sozinho | `.mcp.json` |
| **CLAUDE.md** | Regras de arquitetura e design lidas automaticamente por toda sessão | raiz |

Ao abrir o repositório no Claude Code, ele pergunta uma vez se você confia nos servidores do `.mcp.json`. Responda sim.

### Precisam de você (conta, chave ou decisão)
| O quê | Para quê | Como |
|---|---|---|
| **21st.dev Magic MCP** | Gera componentes de interface a partir de descrição | Criar chave em 21st.dev e rodar `claude mcp add magic -e API_KEY=sua-chave -- npx -y @21st-dev/magic@latest` |
| **Figma** (já aparece nos seus conectores) | Se você desenhar telas ou o pôster do estande no Figma, o agente lê direto | Autorizar em claude.ai → Configurações → Conectores |
| **Higgsfield** (já conectado) | Vídeo de divulgação do estande, imagens para pôster e redes | Já disponível; gerar consome créditos, então peça explicitamente |
| **Vercel** (já conectado) | Publicar uma versão web para quem quiser abrir no celular pelo QR code do estande | Peça "publique na Vercel"; cria um projeto na sua conta |

### Referências para mostrar ao agente ("quero algo assim")
- **three.js examples** (threejs.org/examples) e **Discover three.js**: iluminação, sombras, instancing, pós-processamento.
- **Bruno Simon** (bruno-simon.com) e **Three.js Journey**: referência de mundo 3D interativo com personalidade.
- **Townscaper**, **Islanders**, **Mini Motorways**: estética de diorama e paleta para mundos pequenos.
- **Codrops** (tympanus.net/codrops): efeitos de interface e shaders com código.
- **Poly Haven** (polyhaven.com): texturas e HDRIs CC0, se quiser materiais mais ricos.
- **Fontshare** e **Google Fonts**: alternativas de fonte (lembre de embutir só o subconjunto latin).

Dica: mande o link de um site ou vídeo e diga "quero esse efeito na parte X do EMERGENCE". O agente consegue abrir a página e adaptar.

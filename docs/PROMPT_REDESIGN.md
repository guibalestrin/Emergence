# Emergence: prompt de redesign

Este arquivo tem duas partes:

1. **Diagnóstico**: o que o projeto é hoje e por que ele "parece IA".
2. **Prompt**: o texto para colar numa sessão do Claude Code (ou outro agente) e executar o redesign em fases.

No fim há uma lista de **integrações e ferramentas** que dão ao agente mais recursos para ir melhorando o projeto.

---

## 1. Diagnóstico do projeto atual

| Item | Situação hoje | Problema |
|---|---|---|
| Estrutura | `App.tsx` renderiza **12 PNGs** empilhados (`/public/1_hero.png` … `11_offerstack.png`) + 2 CTAs em HTML | Toda a página é uma imagem. Nada é interativo, animável ou indexável. |
| Peso | ~23 MB de PNG (1,5–2 MB cada) | Em 4G, o hero leva vários segundos. Tráfego de anúncio vem quase todo de celular, então isso derruba a conversão. |
| Texto | Todo o copy está "queimado" dentro das imagens | Zero SEO, leitor de tela não lê, não dá pra fazer teste A/B de headline, fonte borrada em telas grandes. |
| Visual "de IA" | Preto + dourado neon + vermelho, grade de cards com ícone em cima, ✓/✗ lado a lado, homem sério olhando o celular, tudo centralizado, glow em tudo | É exatamente o template que ferramentas de IA geram por padrão. O público já reconhece. |
| Tipografia | Georgia + Arial no HTML; condensada genérica nas imagens | Sem identidade, e o HTML não combina com as imagens. |
| Animação | Só `btn-pulse` no CTA e o popup | Página estática. |
| Popup de prova social | `SocialProofPopup` sorteia nomes e números ("23 pessoas adquiriram…", "Carlos comprou agora!") | **Dado inventado.** É propaganda enganosa pelo CDC (art. 37), viola a política de anúncios da Meta e da Kiwify e pode derrubar a conta de anúncios. Tem que virar dado real ou sair. |
| Lixo | `@supabase/supabase-js` instalado e não usado; `11_offerstack2.png` não referenciado | Peso morto. |
| Rotas | `/privacidade`, `/termos`, `/suporte` resolvidas por `window.location` | Funciona, mas depende de rewrite no host. |

**Conceito que já existe e está desperdiçado:** a marca é *Caverna de Alexandria* e o produto fala de "sinais invisíveis" e de ser "percebido". Isso é literalmente a **Alegoria da Caverna** de Platão: homens que só veem sombras na parede até saírem para a luz. E o repositório agora se chama **Emergence** (emergir). Esse é o fio condutor do redesign: **sair da sombra para a luz**, e não "mais um site preto e dourado".

---

## 2. O prompt

> Copie tudo dentro do bloco abaixo e cole numa sessão do Claude Code aberta neste repositório. Ele foi escrito para ser executado **em fases**, com um commit e uma checagem visual por fase. Assim você pode parar, revisar e redirecionar no meio.

```text
Você vai redesenhar a landing page em Projeto_Anti/ (React 18 + Vite + TS + Tailwind).
Objetivo: transformar uma página feita de 12 imagens PNG geradas por IA numa página
real, em HTML, com profundidade 3D, animações guiadas por scroll e identidade própria,
sem cara de template de IA, mantendo (ou melhorando) a conversão para o checkout
https://pay.kiwify.com.br/kTyieX6.

## Contexto
- Produto: "Código Anti-Rejeição", da marca "Caverna de Alexandria". Público: homens
  adultos, quase 100% mobile, vindos de anúncios do Instagram/Facebook.
- Hoje cada seção é um PNG em Projeto_Anti/public/ (1_hero, 2_bigpromise, 3_quebra,
  4_causaoculta, 5_inimigo, 6_doremocional, 7_storytelling, 8_mecanismo, 9_como,
  10_provas, 10_1_provas, 11_offerstack). O copy está DENTRO das imagens.
- Conceito criativo: Alegoria da Caverna. O homem comum é uma SOMBRA projetada na
  parede (perfil invisível); o método é o caminho para fora da caverna, até a LUZ
  (perfil percebido). O scroll inteiro é essa jornada, da escuridão para a luz.
  O nome do projeto é "Emergence".

## Regras inegociáveis
1. Mobile first. Teste em 390x844 antes de qualquer outro tamanho. LCP < 2,5 s em 4G.
   Peso total da página inicial < 1,5 MB (sem contar o 3D carregado sob demanda).
2. Todo texto vira HTML real (h1, h2, p), legível e indexável. Nada de texto em imagem.
3. Nada de dado inventado. Remova o SocialProofPopup atual (nomes e números sorteados).
   Se eu fornecer números reais de vendas ou depoimentos reais, use esses; senão, a
   seção de provas usa só os prints/depoimentos que já estão em 10_provas e 10_1_provas.
   Não invente depoimentos, contagens, "pessoas vendo agora" ou timers falsos.
4. Respeite prefers-reduced-motion: com ele ligado, sem 3D animado e sem parallax,
   só fades curtos.
5. O 3D é um realce, não uma dependência. Se WebGL falhar ou o aparelho for fraco
   (navigator.hardwareConcurrency <= 4 ou deviceMemory <= 4), mostre um fallback
   estático (imagem AVIF/WebP ou gradiente) com o mesmo enquadramento.
6. Acessibilidade WCAG AA: contraste, foco visível, alt descritivo, botões com
   área de toque >= 44px.
7. Mantenha o pixel da UTMify em index.html e as rotas /privacidade, /termos, /suporte.

## Anti "cara de IA": evite explicitamente
- Grade de 3 a 5 cards iguais com ícone em cima, título e 2 linhas.
- Tudo centralizado. Use grid editorial assimétrico, texto alinhado à esquerda,
  quebras de coluna, elementos que vazam da margem.
- Glow neon, glassmorphism em tudo, gradiente roxo/dourado genérico, sombras
  coloridas em todo card.
- Comparações ✓/✗ lado a lado como recurso principal.
- Ícones Lucide genéricos como decoração (olho, coroa, escudo, gráfico subindo).
- Fontes Inter/Arial/Georgia. Emojis.
- "Homem sério olhando o celular" como imagem principal.

## Direção de arte
- Paleta: preto quente de pedra (#0B0A08), sombra (#1A1713), ocre/âmbar de chama
  (#C8893A), luz do dia quase branca (#F3EDE2). Vermelho só para estado de erro,
  nunca decorativo. Defina tudo como CSS variables + tokens no tailwind.config.js.
- Tipografia: display serifada editorial com personalidade (ex.: "Instrument Serif",
  "Fraunces" ou "PP Editorial New") para headlines grandes; grotesca limpa
  (ex.: "Satoshi" ou "General Sans" da Fontshare, ou "Geist") para corpo.
  Headlines enormes (clamp(2.75rem, 11vw, 7rem)), entrelinha apertada, uma palavra-chave
  por headline em itálico ou na cor âmbar, não em caixa-alta gritando.
- Textura: grão de filme sutil (SVG noise com opacidade 0.04) sobre tudo.
- Luz como linguagem: a página começa quase escura e vai clareando seção a seção.
  As últimas seções (mecanismo, oferta) já estão "do lado de fora", com fundo claro.

## Stack a adicionar
- three + @react-three/fiber + @react-three/drei (cena 3D), com
  @react-three/postprocessing só se couber no orçamento de performance.
- motion (pacote "motion", antigo framer-motion) para animações de componente.
- gsap + ScrollTrigger para coreografia de scroll (pin, scrub).
- lenis para scroll suave (desativado com reduced-motion).
- Carregue o 3D com React.lazy + Suspense e só monte o Canvas quando a seção entra
  na viewport (IntersectionObserver). dpr={[1, 1.5]} no mobile.
- Remova @supabase/supabase-js e 11_offerstack2.png se não forem usados.

## Fases (faça uma por vez, commite e me mostre screenshots em 390px e 1440px)

### Fase 0: Fundação
- Leia cada PNG em public/ e transcreva TODO o copy para src/content/copy.ts,
  organizado por seção. Esse arquivo vira a fonte única de texto.
- Converta as imagens que continuarem sendo usadas (fotos de pessoas, prints de
  prova) para AVIF + WebP com <picture>, em 2 larguras (640 e 1280).
- Crie tokens de design (cores, fontes, espaçamentos, raios, easing) e uma página
  /styleguide interna só em dev.
- Quebre App.tsx em src/sections/*.tsx, um componente por seção.

### Fase 1: Hero 3D ("A Caverna")
- Cena R3F em tela cheia: interior de caverna escura, poeira em suspensão
  (Points com shader simples), um feixe de luz volumétrico vindo do alto, e uma
  silhueta humana projetada como sombra na parede (plano com textura alpha).
- Headline em HTML por cima do canvas. Ao rolar, a câmera avança em direção à luz
  (ScrollTrigger scrub) e a sombra na parede "se desfaz".
- No mobile, a câmera reage ao giroscópio (DeviceOrientation, com fallback de toque);
  no desktop, ao mouse, com amortecimento (lerp 0.05).
- CTA "Ver o sistema completo" magnético no desktop, com feedback tátil
  (navigator.vibrate(10)) no mobile.

### Fase 2: Narrativa (seções 2 a 7)
- Big promise, quebra de padrão, causa oculta, inimigo, dor emocional, storytelling.
- Cada headline entra com split por palavra (mascarada, de baixo para cima, stagger
  40 ms). Parágrafos com fade + 12px de translate. Nada de bounce.
- "Inimigo": pin da seção; o texto troca de 3 frases conforme o scroll, com uma
  forma escura que avança e cobre a tela.
- "Dor emocional": tipografia gigante que preenche de âmbar conforme o scroll
  (background-clip:text com progresso do ScrollTrigger).
- Storytelling: layout de revista, foto em coluna lateral com parallax lento,
  citação em destaque com aspas tipográficas grandes.

### Fase 3: Mecanismo (seção 8, peça central em 3D)
- Celular 3D (modelo .glb leve, < 300 KB, ou um RoundedBox do drei com tela em
  textura) que gira no scroll. A tela mostra um perfil de app de relacionamento
  passando de "sombra" (desfocado, dessaturado, métricas baixas) para "luz"
  (nítido, quente, métricas altas). Faça a transição com um shader de dissolve,
  não com fade simples.
- Os 5 sinais (presença, status, direção, confiança, valor social) NÃO viram grade
  de cards: viram rótulos que orbitam o celular e acendem um por vez.

### Fase 4: Como funciona + Provas
- "Como funciona": linha do tempo vertical com o traço desenhado pelo scroll
  (SVG stroke-dashoffset), passos numerados com numeral serifado grande.
- Provas: carrossel arrastável (drag com motion) dos prints reais, com leve
  inclinação 3D (rotateY baseado na velocidade do arraste). Sem números inventados.

### Fase 5: Oferta
- Mockup 3D do produto (livro/ebook) que reage ao mouse/giroscópio.
- Bônus como "objetos sobre uma mesa" com sobreposição e profundidade, não grade.
- Ancoragem de preço: contador animado de R$ 338 caindo para R$ 47 quando a
  seção entra na viewport (uma vez só).
- Selo de garantia em SVG com rotação lenta.
- CTA final fixo no rodapé (sticky) a partir da seção 8 no mobile.

### Fase 6: Polimento e medição
- Cursor customizado no desktop (círculo que cresce sobre links).
- Transição de página para /privacidade, /termos, /suporte.
- Rode Lighthouse mobile e me passe Performance, LCP, CLS, INP e peso total.
  Meta: Performance >= 85, CLS < 0.05.
- Teste com Playwright em 390x844 e 1440x900, com e sem reduced-motion, e me
  mostre os screenshots.
- Adicione eventos de scroll depth (25/50/75/100) e clique no CTA ao pixel existente.

## Como trabalhar
- Antes de codar cada fase, me mostre em 5 linhas o que vai fazer.
- Busque inspiração e componentes nas fontes listadas em docs/PROMPT_REDESIGN.md,
  mas ADAPTE à direção de arte. Nunca cole um componente com o estilo padrão dele.
- Ao terminar cada fase: npm run build, npm run lint, screenshots, commit.
```

---

## 3. Integrações e ferramentas para dar ao agente

Separei pelo que cada uma resolve. As marcadas com ⭐ são as que eu instalaria primeiro.

### MCP servers (o agente usa direto, como ferramenta)

| Ferramenta | Para quê | Como ativar |
|---|---|---|
| ⭐ **Context7** | Documentação atualizada de R3F, drei, GSAP, Motion, Lenis. Evita que o agente use API antiga. | MCP `@upstash/context7-mcp` |
| ⭐ **21st.dev Magic** | Gera e busca componentes React/Tailwind prontos (heros, cards, CTAs) a partir de descrição. | MCP `@21st-dev/magic` (pede API key em 21st.dev) |
| ⭐ **shadcn MCP** | Navega e instala componentes do shadcn/ui e de registries compatíveis (Magic UI, Aceternity, Origin UI). | `npx shadcn@latest mcp init` |
| **Figma** (já aparece na sua conta, falta autorizar) | Se você desenhar ou ajustar telas no Figma, o agente lê frames, tokens e medidas direto. | Autorizar nos conectores do claude.ai |
| **Higgsfield** (já conectado) | Gerar vídeo de fundo do hero, texturas da caverna, fotos de perfil "antes/depois" com mais qualidade que os PNGs atuais. | Já disponível |
| **Vercel** (já conectado) | Deploy de preview por fase, logs, analytics de performance real. | Já disponível |
| **Playwright** (já instalado no ambiente) | Screenshots e testes visuais em mobile/desktop a cada fase. | Já disponível |

### Skills já disponíveis na sua conta
- `motionsites-web-builder`: monta landing pages cinematográficas com loop de screenshot e correção.
- `site-de-10k`: site guiado por scroll com vídeo hero.
- `design:design-critique` e `design:accessibility-review`: revisão de cada fase.

### Bibliotecas de componentes e efeitos (copiar e adaptar)
- ⭐ **React Bits** (reactbits.dev): text animations, backgrounds, efeitos 3D leves. Ótimo para os splits de headline.
- ⭐ **Aceternity UI** (ui.aceternity.com): parallax, 3D card, spotlight, tracing beam (serve para a linha do tempo).
- **Magic UI** (magicui.design): number ticker (preço), marquee, shine border.
- **Motion Primitives** (motion-primitives.com): primitivas com Motion, bem limpas.
- **Origin UI / shadcn/ui**: base de formulários, dialogs e acessibilidade.
- **GSAP** (gsap.com): todos os plugins (SplitText, ScrollTrigger, MorphSVG) são gratuitos desde 2025.

### 3D e assets
- ⭐ **Spline** (spline.design): monta a cena da caverna ou o celular 3D visualmente e exporta para React (`@splinetool/react-spline`). Mais rápido que modelar em código.
- **pmndrs/drei** e **R3F examples** (r3f.docs.pmnd.rs): exemplos prontos de partículas, luz volumétrica, reflexos.
- **Poly Haven** (polyhaven.com): texturas de pedra e HDRIs gratuitos (CC0).
- **Sketchfab** (filtro CC0/CC-BY): modelos de celular, livro, tocha.
- **gltf.report / gltfjsx**: comprime .glb (Draco/Meshopt) e converte em componente React.

### Tipografia
- **Fontshare** (fontshare.com): Satoshi, General Sans, Clash Display, gratuitas para uso comercial.
- **Google Fonts**: Instrument Serif, Fraunces.
- **Pangram Pangram** (pangrampangram.com): Editorial New, Neue Montreal (versões free para teste).

### Referência de UI/UX (para mostrar ao agente "quero algo assim")
- ⭐ **Awwwards** (awwwards.com, categoria "Scrolling" e "3D").
- **Godly** (godly.website) e **Land-book** (land-book.com): landing pages reais.
- **Mobbin** (mobbin.com): padrões de app, útil para a "tela de perfil" dentro do celular 3D.
- **Codrops** (tympanus.net/codrops): tutoriais de efeitos de scroll e shaders, com código.
- **Lapa Ninja**: landing pages de infoproduto que não parecem infoproduto.

Dica: quando gostar de um site, mande o link e diga "quero o efeito X dessa seção na nossa seção Y". O agente consegue abrir a página, ler o código e adaptar.

### Medição
- **PageSpeed Insights / Lighthouse**: performance mobile.
- **Microsoft Clarity** (gratuito): heatmap e gravação de sessão para ver onde as pessoas param de rolar. Isso mostra qual seção redesenhar primeiro.

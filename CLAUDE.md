# EMERGENCE: guia para agentes

Simulação de sociedade artificial para a Expo Tech Insper 2026. TypeScript + Vite, sem framework de UI.
A entrega final é **um único HTML offline** (`EMERGENCE.html`), aberto com dois cliques no notebook do estande.

## Comandos

- `npm run dev`: servidor de desenvolvimento
- `npm run build`: typecheck + build + atualiza `EMERGENCE.html` (rode e commite o arquivo após mudanças visuais)
- `npm test`: testes do motor (determinismo, NaN, intervenções). Precisam passar sempre.
- `npm run typecheck`

## Arquitetura

- `src/sim/`: motor da simulação. **Sem DOM.** Roda no navegador, no Web Worker do laboratório e no Node.
  Não importe nada de `src/ui/` aqui. Mudanças aqui alteram resultados científicos (`docs/RESULTADOS.md`).
- `src/ui/main.ts`: app, loop, ferramentas, intro, modais.
- `src/ui/renderer.ts`: visão 2D (Canvas) + interface `WorldView` e funções de cor compartilhadas.
- `src/ui/renderer3d.ts`: visão 3D (three.js, instanced meshes). Mesma interface `WorldView`.
  Tecla `V` alterna; se WebGL falhar, o app fica só em 2D. Navegação: WASD/setas, Q/E, +/−, G (chão),
  T (passeio), R (visão geral). Casas, lenha, celeiros, andaimes e fogueiras de grupo são derivados
  do estado dos abrigos (só visual, o motor não muda).
- Deploy: projeto Vercel `emergence` ligado ao GitHub; cada push publica em https://emergence-insper.vercel.app
- `src/ui/panels.ts`, `charts.ts`, `lab.ts`: painéis, gráficos e laboratório.
- `src/ui/icons.ts`: ícones (lucide) como SVG inline. Não use emoji na interface.

## Regras de design

- Fontes embutidas (offline): Instrument Serif (títulos), IBM Plex Sans (interface), IBM Plex Mono (dados).
  Importe só os subconjuntos `latin-*.css` do @fontsource para não inflar o HTML.
- Paleta em variáveis no topo de `src/style.css`. Âmbar (`--accent`) é o único destaque.
- Evitar cara de template de IA: nada de grade de cards iguais com ícone em cima, emoji, glow neon,
  gradiente roxo. Preferir layout editorial, linhas finas, números grandes em serifa.
- Superfícies flutuantes usam o material "liquid glass" (`.glass` em `src/style.css`): blur + brilho
  interno + sombra longa; refração SVG (`#liquid`) só em barras/dock no Chromium; `body.lowfx` troca o
  blur por tinta opaca quando o FPS cai. Popovers ficam no nível de `#app` (aninhados num pai com
  backdrop-filter eles perdem o próprio fundo). Tokens e componentes espelhados no Figma
  ("EMERGENCE — Liquid Glass UI").
- O mundo ocupa a tela inteira; a câmera 3D enquadra a área livre entre os painéis (`setInsets`).
- Animações curtas com `--ease`; tudo respeita `prefers-reduced-motion`.
- O HTML final deve continuar abaixo de ~2 MB e rodar liso num notebook comum.
- Sem dependência de rede em tempo de execução (nada de CDN, fontes remotas ou APIs).

## Verificação visual

Playwright está disponível (MCP `playwright` em `.mcp.json`, ou `require('playwright')` em script).
Para WebGL headless, lance o Chromium com `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
Depois de qualquer mudança visual: screenshot em 1366×768 e 1920×1080, modo 3D e mapa, dia e noite.
Os painéis se redesenham a cada 250 ms: em testes, dispare `pointerdown` em vez de `click` nos itens da lista.

## Documentação de bibliotecas

Use o MCP `context7` para consultar a API atual de three.js, Vite e lucide antes de escrever código com elas.

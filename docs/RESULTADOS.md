# Resultados experimentais

Condições: 8 sementes (1001–1008) por condição, 96 dias (3 anos), 34 indivíduos iniciais.
Reproduza com `npm run experiment -- <id> 8 96` ou no Laboratório do app. Valores: média ± desvio padrão entre
sementes; *t* = estatística de Welch (|t| > 2,2 ≈ diferença maior que a variação entre sementes).

> Estes são resultados **deste modelo**. Eles mostram consequências das regras escolhidas, não leis sobre
> sociedades humanas.

## 1. Aprender com a experiência (`learning`) — efeito forte

| Métrica | Com aprendizado | Sem aprendizado | t |
|---|---|---|---|
| Roubos | 77 ± 85 | **473 ± 270** | −4,0 |
| Índice de cooperação | 0,70 ± 0,20 | 0,30 ± 0,28 | 3,3 |
| Confiança entre conhecidos | 0,59 ± 0,13 | 0,25 ± 0,17 | 4,3 |
| Confiança em estranhos | 0,12 ± 0,08 | −0,16 ± 0,20 | 3,7 |
| População final | 36,9 ± 14,4 | 37,1 ± 12,6 | 0,0 |

Sem aprendizado, os agentes roubam ~6× mais e a confiança social desaba. Com ele, quem é pego aprende que roubar não
compensa. A população final não muda: o roubo redistribui a comida mais do que a destrói.

## 2. Escassez × cooperação (`scarcity`) — relação não-monotônica

| Métrica | Escasso 0,6× | Normal 1× | Abundante 1,6× |
|---|---|---|---|
| População final | 12,4 ± 9,5 | 36,9 ± 14,4 | 59,4 ± 10,5 |
| Índice de cooperação | 0,37 ± 0,15 | 0,70 ± 0,20 | 0,66 ± 0,18 |
| Confiança em estranhos | −0,08 ± 0,14 | 0,12 ± 0,08 | 0,10 ± 0,05 |
| Grupos (média) | 2,4 ± 1,4 | 6,1 ± 2,6 | 9,2 ± 1,4 |

A escassez derruba cooperação e confiança. Mais abundância não aumenta a cooperação indefinidamente: com fartura, a
população cresce e volta a disputar recursos (o roubo também aumenta).

## 3. Conhecimento compartilhado (`knowledge`) — resultado contraintuitivo

| Métrica | Compartilham locais | Não compartilham | t |
|---|---|---|---|
| População final | 36,9 ± 14,4 | 49,0 ± 9,7 | −2,0 |
| Doações | 96 ± 65 | 170 ± 60 | −2,4 |

Esperávamos que contar aos outros onde há comida ajudasse. Aconteceu o oposto (tendência): todos convergem para os
mesmos arbustos, que se esgotam — uma pequena **tragédia dos comuns**. Sem compartilhamento, os indivíduos se
espalham pelo mapa. Um bom exemplo de efeito emergente que não estava no design.

## 4. Choque de seca (`drought`) — colapso

| Métrica | Sem seca | Seca no dia 40 (16 dias) | t |
|---|---|---|---|
| População final | 36,9 ± 14,4 | 5,8 ± 5,5 | 5,7 |
| Mortes | 24,5 ± 6,0 | 45,1 ± 7,7 | −6,0 |
| Doações | 96 ± 65 | 44 ± 13 | 2,2 |

Uma seca no fim do verão impede a formação de estoques; o inverno seguinte é devastador. A ajuda cai — quem tem
pouco não doa.

## 5. Fofoca (`gossip`) — sem efeito claro

| Métrica | Com fofoca | Sem fofoca | t |
|---|---|---|---|
| Roubos | 77 ± 85 | 104 ± 104 | −0,6 |
| Confiança entre conhecidos | 0,59 ± 0,13 | 0,45 ± 0,14 | 1,9 |
| Nascimentos | 27,4 ± 10,3 | 18,0 ± 5,8 | 2,2 |

A fofoca tende a aumentar a confiança (e, por isso, mais pares formam família), mas não reduziu o roubo de forma
detectável. **Resultado nulo**: neste modelo, testemunhas diretas e aprendizado individual já fazem a maior parte do
trabalho. Mais sementes poderiam revelar um efeito menor.

## Padrões observados no mundo ao vivo

- **Desigualdade sazonal**: o Gini sobe de ~0,2 para 0,5–0,65 a cada inverno e recua na primavera.
- **Crise do primeiro inverno**: sem abrigos e estoques, 20–30% morrem; os sobreviventes (e seus filhos) se preparam melhor.
- **Armadilha do ladrão**: indivíduos com má reputação são recusados, ficam com fome e roubam mais — um ciclo vicioso.
- **Alta variância**: a mesma configuração com sementes diferentes produz sociedades muito diferentes.

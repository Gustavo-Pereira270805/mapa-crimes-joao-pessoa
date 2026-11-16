# Observatório JP — Mapa de Crimes de João Pessoa

Protótipo demonstrativo de um observatório urbano para João Pessoa/PB. O site combina
um mapa de pontos, um mapa de calor, um coroplético por crime predominante e outro por
densidade de notícias por km², com filtros por período, tipo de crime e bairro.

> **Importante:** este é um protótipo. Os pontos representam **notícias policiais
> geocodificadas por bairro**, não o universo de ocorrências. A Paraíba não publica
> microdados de boletins de ocorrência por bairro. Os números oficiais de CVLI são
> exibidos apenas como contexto.

## O que o site mostra

- **Mapa de pontos:** cada ponto é uma notícia policial; o popup traz título, data,
  bairro, veículo, trecho e link para a matéria original.
- **Crime predominante:** cada bairro é colorido pelo tipo de crime mais frequente
  na amostra filtrada (com desempate por gravidade).
- **Densidade:** notícias por km², em escala logarítmica, usando a área do bairro.
- **Calor:** concentração estimada dos pontos.
- **Filtros:** últimos 30/90/180/365 dias ou todo o período; tipos de crime; bairro.
- **Painel:** série mensal, distribuição por tipo, top 10 bairros e lista de notícias.

## Fontes de dados

| Dado | Fonte |
|---|---|
| Notícias policiais | APIs públicas de posts do [Portal Correio](https://portalcorreio.com.br/) e do [Paraíba.com](https://paraiba.com.br/) |
| Limites dos 64 bairros | [Filipeia — Prefeitura de João Pessoa](https://filipeia.joaopessoa.pb.gov.br/) |
| CVLI em João Pessoa (2025) | Anuário da Segurança e Defesa Social 2025 — SESDS/PB |
| CVLI em João Pessoa (1º semestre/2025) | SESDS/PB — mapa temático (Datawrapper) |
| Homicídios na Paraíba (2025, preliminar) | DataSUS/SIM, compilado pelo [Crime Brasil](https://crimebrasil.com.br/cidade/pb/joao-pessoa) |

## Como os dados foram construídos

1. Coleta das editorias policiais do Portal Correio e do Paraíba.com entre
   16/11/2025 e 16/11/2026, via API REST do WordPress.
2. Filtro geográfico: menções a João Pessoa ou a um dos 64 bairros; exclusão de
   casos de outros municípios e de assuntos sem relação com crimes.
3. Classificação por palavras-chave no título e no lead em: homicídio, feminicídio,
   crime sexual, sequestro, roubo/assalto, tiroteio/arma, tráfico/drogas, violência
   doméstica, furto e operação policial.
4. Identificação do bairro citado e geração de um ponto aleatório **dentro do
   polígono do bairro**. A localização é aproximada; não é o endereço do fato.
5. Deduplicação por similaridade de título e regras para eventos repetidos.

## Limitações

- A amostra é influenciada pela cobertura da imprensa. Crimes com vítimas, operações
  e fatos de grande repercussão têm mais chance de virar notícia.
- Bairros citados de passagem podem gerar ruído.
- A classificação por palavras-chave é imperfeita em casos ambíguos.
- A localização é aproximada dentro do bairro.
- Os números do mapa **não** devem ser comparados com os CVLI oficiais nem usados
  para afirmar que um bairro é mais violento que outro.

## Privacidade e LGPD

- O site não coleta dados pessoais dos visitantes, não usa cookies de rastreamento
  e não cria perfis de vítimas, suspeitos ou testemunhas.
- Exibe título e trecho da notícia original, que podem mencionar nomes públicos.
  O conteúdo completo e o contexto ficam no link do veículo.
- Os dados são públicos e jornalísticos; o site não é um cadastro de antecedentes
  criminais nem uma base de dados de pessoas.

## Rodando localmente

```bash
cd site
python -m http.server 8080
```

Abra `http://localhost:8080`.

## Estrutura

```
site/
├── index.html
├── styles.css
├── app.js
├── data/
│   ├── incidents.json      # notícias geocodificadas
│   ├── bairros.geojson     # 64 bairros com área e centro
│   └── context.json        # indicadores oficiais e limitações
└── README.md
```

## Deploy

O site é estático e pode ser publicado em GitHub Pages, Netlify, Vercel ou
Cloudflare Pages. Basta publicar a pasta `site/` como raiz.

## Créditos

Protótipo demonstrativo construído em novembro de 2026. Dados jornalísticos de
Portal Correio e Paraíba.com; geodados de Filipeia/Prefeitura de João Pessoa;
indicadores oficiais de SESDS/PB e DataSUS/SIM.

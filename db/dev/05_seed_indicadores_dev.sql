-- Indicadores de qualidade SINTÉTICOS para as toras do seed de dev (02).
-- Só para os painéis de qualidade (última inspeção, por talhão, histogramas)
-- terem o que mostrar sem o banco central. Mesmos 8 tipos e mesmos nomes de
-- metodo_medicao que o main.py grava, para o dashboard tratar igual.
--
-- Padrões embutidos, de propósito:
--   * ~60% das toras vistas de LADO (tortuosidade medida), ~40% de SEÇÃO
--     (tortuosidade 0 com metodo 'nao_aplicavel_secao' — NÃO entra em média);
--   * casca residual maior no Talhão Norte (talhao_id = 2);
--   * dois clones: SP3108 (referência genérica, sem faixa) e I144
--     (literatura, faixa 460–510) — para a faixa de massa aparecer.
--   * toras 'reprovado'/'quarentena' têm saúde mais baixa e volume descontado.

INSERT INTO indicadores_qualidade (tora_id, tipo_indicador, valor, unidade, metodo_medicao)
SELECT id, tipo, valor, unidade, metodo
FROM (
  SELECT t.id,
         t.talhao_id,
         t.status_classificacao AS status,
         (random() < 0.6)                         AS de_lado,
         (t.id % 3 = 0)                           AS clone_i144,
         round((12 + random() * 14)::numeric, 2)  AS diam,     -- 12–26 cm
         round((random() * 9)::numeric, 2)        AS tort_raw, -- 0–9 %
         round((CASE WHEN t.talhao_id = 2 THEN 4 + random() * 26 ELSE random() * 12 END)::numeric, 1) AS casca
  FROM toras_inspecionadas t
) b
CROSS JOIN LATERAL (
  SELECT saude, compr, volume,
         CASE WHEN clone_i144 THEN 485.0 ELSE 490.0 END AS dens
  FROM (
    SELECT CASE status WHEN 'aprovado' THEN 0.9 + random() * 0.1
                       WHEN 'quarentena' THEN 0.65 + random() * 0.2
                       ELSE 0.3 + random() * 0.3 END                    AS saude,
           CASE WHEN de_lado THEN round((300 + random() * 320)::numeric, 1) ELSE 600.0 END AS compr
  ) s
  CROSS JOIN LATERAL (
    SELECT round((pi() * power(diam / 200.0, 2) * (compr / 100.0) * saude)::numeric, 3) AS volume
  ) v
) c
CROSS JOIN LATERAL (
  VALUES
    ('densidade',            dens,                         'kg/m3',  'lookup_clone_' || CASE WHEN clone_i144 THEN 'I144' ELSE 'SP3108' END),
    ('altura',               compr,                        'cm',     CASE WHEN de_lado THEN 'imagem_lateral_marcador_aruco' ELSE 'comprimento_tracamento_config' END),
    ('diametro',             diam,                         'cm',     CASE WHEN de_lado THEN 'imagem_lateral_marcador_aruco' ELSE 'imagem_secao_marcador_aruco' END),
    ('tortuosidade',         CASE WHEN de_lado THEN tort_raw ELSE 0 END, 'indice', CASE WHEN de_lado THEN 'opencv_eixo_flecha' ELSE 'nao_aplicavel_secao' END),
    ('porcentagem_casca',    casca,                        '%',      'opencv_otsu_casca_residual'),
    ('volume_util',          volume,                       'm3',     CASE WHEN de_lado THEN 'cilindro_medido' ELSE 'cilindro_diam_medido_compr_config' END),
    ('massa_seca',           round((volume * dens)::numeric, 1), 'kg', 'volume_x_densidade_clone_' || CASE WHEN clone_i144 THEN 'I144' ELSE 'SP3108' END),
    ('apodrecimento_pragas', round((saude * 100)::numeric, 2), '%',   'yolo_severidade')
) AS ind(tipo, valor, unidade, metodo)
WHERE NOT EXISTS (SELECT 1 FROM indicadores_qualidade q WHERE q.tora_id = b.id);

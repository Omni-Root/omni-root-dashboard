-- Dados sintéticos SÓ para desenvolvimento local do dashboard.
-- Padrões embutidos para os gráficos ficarem legíveis:
--   * eventos entre 6h e 21h (turno de operação)
--   * mais falhas no início da tarde (13h–16h) e às segundas/sextas

INSERT INTO maquinas (modelo, numero_serie) VALUES
  ('John Deere 1470G', 'JD1470G-0001'),
  ('John Deere 1270G', 'JD1270G-0002'),
  ('John Deere 959MH', 'JD959MH-0003');

INSERT INTO talhoes (nome, area_hectares, especie) VALUES
  ('Talhão Demo', 42.50, 'Eucalipto'),
  ('Talhão Norte', 61.00, 'Eucalipto');

INSERT INTO toras_inspecionadas
  (uuid_local, maquina_id, talhao_id, log_id, data_inspecao,
   confianca_ia, status_classificacao, hash_sha256)
SELECT
  gen_random_uuid(),
  1 + floor(random() * 3)::int,
  1 + floor(random() * 2)::int,
  'LOG-' || lpad(g::text, 6, '0'),
  ts,
  round((0.55 + random() * 0.44)::numeric, 4),
  CASE
    WHEN random() < (
      0.05
      + CASE WHEN EXTRACT(HOUR FROM ts) BETWEEN 13 AND 16 THEN 0.10 ELSE 0 END
      + CASE WHEN EXTRACT(DOW  FROM ts) IN (1, 5)          THEN 0.05 ELSE 0 END
    ) THEN 'reprovado'
    WHEN random() < 0.10 THEN 'quarentena'
    ELSE 'aprovado'
  END,
  md5(g::text) || md5((g * 7919)::text)
FROM (
  SELECT g,
         (CURRENT_DATE - floor(random() * 90)::int)
           + make_interval(
               hours => 6 + floor(random() * 16)::int,
               mins  => floor(random() * 60)::int,
               secs  => floor(random() * 60)::int
             ) AS ts
  FROM generate_series(1, 8000) AS g
) src;

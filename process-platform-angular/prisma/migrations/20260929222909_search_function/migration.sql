-- #35 UX-01c full-text bez ohladu na diakritiku; oddelovace kodov (PR-07, 4.2/b)
-- sa menia na medzery, inak by parser cital „-07“ ako zaporne cislo.
-- IMMUTABLE — da sa na nej neskor postavit GIN index vyrazu.
CREATE OR REPLACE FUNCTION pb_search_vector(body text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_tsvector('simple', regexp_replace(
    translate(lower(coalesce(body, '')), 'áäčďéěíĺľňóôöŕřšťúůüýž', 'aacdeeillnooorrstuuuyz'),
    '[-_./]', ' ', 'g'))
$$;

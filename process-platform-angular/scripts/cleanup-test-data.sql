-- Zmaze syntetické testovacie firmy a účty, ktoré zakladajú skripty v scripts/*.mjs.
-- Skutočné firmy nemajú tieto prefixy názvov ani domény example.test.
-- Spustenie: docker exec -i process-platform-angular-postgres-1 psql -U process_user -d process_platform < scripts/cleanup-test-data.sql
-- Súbory príloh zmazaných firiem v storage/uploads/<organizationId> treba zmazať zvlášť.
delete from "Organization" where name like 'Izolacia _ %' or name like 'Org Test %' or name like 'Org UI Test %' or name like 'Ulozisko Test %' or name like 'Migracia Test %';
delete from "User" where email like 'izolacia-%@example.test' or email like 'orgtest-%@example.test' or email like 'orgui-%@example.test' or email like 'ulozisko-%@example.test' or email like 'migracia-%@example.test' or email = 'kolega@example.test';
delete from "EmailOutbox" where "toAddress" like '%@example.test';

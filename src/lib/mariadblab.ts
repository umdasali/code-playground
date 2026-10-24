// The exercises of the MariaDB tab: each one sets up a fresh server and lists checks over its final state.
import { Maria } from "./mariadb";
import { buildSampleSql, EXERCISES as SHOP_QUERIES } from "./sample-data";

export interface Check { text: string; done: boolean }
export interface MariaExercise {
  id: string;
  group: string;
  title: string;
  brief: string[];
  hints: string[];
  start: "client" | "shell";
  setup: (m: Maria) => void;
  checks: (m: Maria) => Check[];
}

const loadShop = (m: Maria) => m.load("shop", buildSampleSql("mysql"));

const SCHOOL = `CREATE TABLE students (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL, grade INT, email VARCHAR(100), nickname VARCHAR(30));
INSERT INTO students (name, grade, email, nickname) VALUES ('Asha', 90, 'asha@school.in', 'A'), ('Ben', 75, 'ben@school.in', NULL), ('Chen', 35, 'chen@school.in', 'C'), ('Dana', 55, 'dana@school.in', NULL), ('Eli', 28, 'eli@school.in', 'E');`;
const loadSchool = (m: Maria) => m.load("school", SCHOOL);

const BANK = `CREATE TABLE accounts (id INT PRIMARY KEY, owner VARCHAR(30) NOT NULL, balance DECIMAL(10,2) NOT NULL);
INSERT INTO accounts VALUES (1, 'alice', 500.00), (2, 'bob', 300.00);`;

const num = (rows: unknown[][]) => Number(rows[0]?.[0] ?? NaN);
const colOf = (m: Maria, db: string, t: string, c: string) => m.tableMeta(db, t)?.cols.find((x) => x.name === c);

// A drill is solved when a SELECT you ran in the shop database returned the same rows as the reference query.
const norm = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 100) / 100) : v === null ? "NULL" : String(v));
function solved(m: Maria, db: string, sql: string): boolean {
  const expected = m.evaluate(db, sql);
  if (!expected) return false;
  const ordered = /\bORDER\s+BY\b/i.test(sql);
  const key = (rows: unknown[][]) => { const k = rows.map((r) => r.map(norm).join("\u0001")); return ordered ? k : k.sort(); };
  const want = key(expected.rows).join("\n");
  return m.selectedRows(db).some((r) => r.columns.length === expected.columns.length && key(r.rows).join("\n") === want);
}

const DRILLS = SHOP_QUERIES.slice(0, 10).map((q) => ({ text: q.title, sql: q.sql }));

const FUNCTION_DRILLS: { text: string; sql: string }[] = [
  { text: "Show each customer's name in UPPER case with its length (UPPER, CHAR_LENGTH), five names in alphabetical order", sql: "SELECT UPPER(name), CHAR_LENGTH(name) FROM customers ORDER BY name LIMIT 5;" },
  { text: "One column called label: name and country as 'Name (Country)' for customers in the USA, by name (CONCAT)", sql: "SELECT CONCAT(name, ' (', country, ')') AS label FROM customers WHERE country = 'USA' ORDER BY name;" },
  { text: "Number of orders per month as 'YYYY-MM' (DATE_FORMAT), in month order", sql: "SELECT DATE_FORMAT(ordered_at, '%Y-%m') AS ym, COUNT(*) FROM orders GROUP BY ym ORDER BY ym;" },
  { text: "First 8 customers by id, showing 'no email' where the email is missing (IFNULL)", sql: "SELECT name, IFNULL(email, 'no email') FROM customers ORDER BY id LIMIT 8;" },
  { text: "Three customers who joined longest before 2025-12-31, with the number of days (DATEDIFF)", sql: "SELECT name, DATEDIFF('2025-12-31', joined) AS days FROM customers ORDER BY days DESC LIMIT 3;" },
  { text: "Average product price per category, rounded to 2 decimals (ROUND)", sql: "SELECT category_id, ROUND(AVG(price), 2) FROM products GROUP BY category_id;" },
];

export const MARIA_EXERCISES: MariaExercise[] = [
  {
    id: "create-db", group: "Databases and tables", title: "Create a database and a table", start: "client",
    brief: [
      "Create a database named school and, inside it, a table students with these columns:",
      "id (INT, auto-increment primary key), name (VARCHAR(50), required), grade (INT), email (VARCHAR(100), unique).",
      "Then insert at least three students and check the structure with DESCRIBE students and SHOW CREATE TABLE students.",
    ],
    hints: ["CREATE DATABASE school;", "USE school;", "CREATE TABLE students (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL, grade INT, email VARCHAR(100) UNIQUE);", "INSERT INTO students (name, grade, email) VALUES ('Asha', 90, 'asha@school.in'), ('Ben', 75, 'ben@school.in'), ('Chen', 62, 'chen@school.in');", "SHOW DATABASES;", "SHOW TABLES;", "DESCRIBE students;", "SHOW CREATE TABLE students\\G", "SELECT * FROM students;"],
    setup: () => {},
    checks: (m) => {
      const id = colOf(m, "school", "students", "id");
      const name = colOf(m, "school", "students", "name");
      const email = colOf(m, "school", "students", "email");
      return [
        { text: "Database school exists", done: m.hasDatabase("school") },
        { text: "Table school.students exists", done: !!m.tableMeta("school", "students") },
        { text: "id is an INT primary key with AUTO_INCREMENT", done: !!id && /^int/.test(id.type) && id.key === "PRI" && /auto_increment/.test(id.extra) },
        { text: "name is VARCHAR(50) NOT NULL", done: !!name && name.type === "varchar(50)" && !name.nullable },
        { text: "grade is an INT column", done: /^int/.test(colOf(m, "school", "students", "grade")?.type ?? "") },
        { text: "email is VARCHAR(100) with a UNIQUE key", done: !!email && email.type === "varchar(100)" && email.key === "UNI" },
        { text: "At least 3 students are stored", done: num(m.peek("school", "SELECT COUNT(*) FROM students")) >= 3 },
      ];
    },
  },
  {
    id: "crud", group: "Databases and tables", title: "Insert, update and delete rows", start: "client",
    brief: [
      "The school database has a students table with five students (try SELECT * FROM students first).",
      "1) Insert a new student Fatima with grade 88. 2) Change only Ben's grade to 80. 3) Delete every student whose grade is below 40.",
      "Be careful with WHERE: an UPDATE or DELETE without it changes every row.",
    ],
    hints: ["USE school;", "SELECT * FROM students;", "INSERT INTO students (name, grade, email) VALUES ('Fatima', 88, 'fatima@school.in');", "UPDATE students SET grade = 80 WHERE name = 'Ben';", "DELETE FROM students WHERE grade < 40;", "SELECT name, grade FROM students ORDER BY grade DESC;", "START TRANSACTION;", "ROLLBACK;"],
    setup: (m) => { loadSchool(m); m.current = "school"; },
    checks: (m) => [
      { text: "Fatima (grade 88) is in the table", done: num(m.peek("school", "SELECT COUNT(*) FROM students WHERE name='Fatima' AND grade=88")) >= 1 },
      { text: "Ben's grade is 80 and nobody else was changed", done: num(m.peek("school", "SELECT COUNT(*) FROM students WHERE name='Ben' AND grade=80")) === 1 && num(m.peek("school", "SELECT COUNT(*) FROM students WHERE (name='Asha' AND grade=90) OR (name='Dana' AND grade=55)")) === 2 },
      { text: "No student with a grade below 40 is left", done: num(m.peek("school", "SELECT COUNT(*) FROM students WHERE grade < 40")) === 0 },
      { text: "Four students remain (Asha, Ben, Dana, Fatima): nothing extra was deleted", done: num(m.peek("school", "SELECT COUNT(*) FROM students")) === 4 },
    ],
  },
  {
    id: "alter", group: "Databases and tables", title: "Change a table with ALTER TABLE", start: "client",
    brief: [
      "The students table (database school) needs changes:",
      "1) add a column city VARCHAR(40) with default 'Dhanbad'; 2) rename the column grade to score (keep the data); 3) make email unique;",
      "4) add an index named idx_name on name; 5) drop the unused column nickname. Check the result with DESCRIBE students and SHOW INDEX FROM students.",
    ],
    hints: ["USE school;", "DESCRIBE students;", "ALTER TABLE students ADD COLUMN city VARCHAR(40) DEFAULT 'Dhanbad';", "ALTER TABLE students CHANGE grade score INT;", "ALTER TABLE students ADD UNIQUE KEY uq_email (email);", "CREATE INDEX idx_name ON students (name);", "ALTER TABLE students DROP COLUMN nickname;", "SHOW INDEX FROM students;", "SHOW CREATE TABLE students\\G"],
    setup: (m) => { loadSchool(m); m.current = "school"; },
    checks: (m) => {
      const city = colOf(m, "school", "students", "city");
      const t = m.tableMeta("school", "students");
      return [
        { text: "Column city VARCHAR(40) with default 'Dhanbad'", done: city?.type === "varchar(40)" && city.def === "Dhanbad" },
        { text: "grade was renamed to score and Asha still has 90", done: !colOf(m, "school", "students", "grade") && num(m.peek("school", "SELECT score FROM students WHERE name='Asha'")) === 90 },
        { text: "email has a UNIQUE key", done: colOf(m, "school", "students", "email")?.key === "UNI" },
        { text: "Index idx_name exists on name", done: !!t?.indexes.some((i) => i.name === "idx_name" && i.cols.join() === "name") },
        { text: "Column nickname is gone", done: !!t && !t.cols.some((c) => c.name === "nickname") },
      ];
    },
  },
  {
    id: "drills", group: "Queries", title: "Query drills on the shop database", start: "client",
    brief: [
      "The shop database has departments, employees, customers, categories, products, orders, order_items and reviews (try SHOW TABLES and DESCRIBE).",
      "Write a query for each task below. A task is solved when a SELECT you run returns the same rows as the reference answer (column names do not matter).",
    ],
    hints: ["USE shop;", "SHOW TABLES;", "DESCRIBE products;", "SELECT * FROM customers LIMIT 5;", "SELECT COUNT(*) FROM orders;"],
    setup: (m) => { loadShop(m); m.current = "shop"; },
    checks: (m) => DRILLS.map((d) => ({ text: d.text, done: solved(m, "shop", d.sql) })),
  },
  {
    id: "functions", group: "Queries", title: "Functions, dates and strings", start: "client",
    brief: [
      "MariaDB has its own functions for text, dates and NULLs. Use them on the shop database to answer each task.",
      "A task is solved when a SELECT you run returns the same rows as the reference answer.",
    ],
    hints: ["USE shop;", "SELECT UPPER('maria'), CHAR_LENGTH('maria'), CONCAT('a', 'b');", "SELECT DATE_FORMAT('2025-03-09', '%W %d %M %Y');", "SELECT DATE_ADD('2025-01-31', INTERVAL 1 MONTH), DATEDIFF('2025-12-31', '2025-01-01');", "SELECT IFNULL(NULL, 'x'), IF(1 < 2, 'yes', 'no'), ROUND(2.567, 1);", "DESCRIBE orders;"],
    setup: (m) => { loadShop(m); m.current = "shop"; },
    checks: (m) => FUNCTION_DRILLS.map((d) => ({ text: d.text, done: solved(m, "shop", d.sql) })),
  },
  {
    id: "indexes", group: "Performance", title: "Indexes and EXPLAIN", start: "client",
    brief: [
      "Find out how MariaDB runs a query: EXPLAIN SELECT * FROM customers WHERE email = 'asha@example.com'; type ALL means a full table scan.",
      "Create an index on customers(email), run the same EXPLAIN again and see the key column change, then list the table's indexes with SHOW INDEX.",
    ],
    hints: ["USE shop;", "EXPLAIN SELECT * FROM customers WHERE email = 'asha@example.com';", "CREATE INDEX idx_email ON customers (email);", "SHOW INDEX FROM customers;", "EXPLAIN SELECT * FROM customers WHERE id = 5;", "DROP INDEX idx_email ON customers;"],
    setup: (m) => { loadShop(m); m.current = "shop"; },
    checks: (m) => {
      const hasIdx = !!m.tableMeta("shop", "customers")?.indexes.some((i) => !i.primary && i.cols[0] === "email");
      return [
        { text: "You saw a full table scan (EXPLAIN with type ALL)", done: m.hasEvent("explain-all") },
        { text: "An index on customers(email) exists", done: hasIdx },
        { text: "EXPLAIN now uses an index other than PRIMARY (key column)", done: hasIdx && m.events.some((e) => e.startsWith("explain-key:") && e !== "explain-key:PRIMARY") },
        { text: "You listed the indexes with SHOW INDEX", done: m.hasEvent("show-index") },
      ];
    },
  },
  {
    id: "transactions", group: "Reliability", title: "Transactions: rollback and commit", start: "client",
    brief: [
      "The bank database has accounts: alice 500, bob 300. Practise START TRANSACTION, ROLLBACK and COMMIT.",
      "1) Start a transaction, take 100 from alice, look at the table, then ROLLBACK and confirm the balance is back. 2) Transfer 100 from alice to bob inside a transaction and COMMIT.",
    ],
    hints: ["USE bank;", "SELECT * FROM accounts;", "START TRANSACTION;", "UPDATE accounts SET balance = balance - 100 WHERE owner = 'alice';", "UPDATE accounts SET balance = balance + 100 WHERE owner = 'bob';", "ROLLBACK;", "COMMIT;", "SET autocommit = 0;"],
    setup: (m) => { m.load("bank", BANK); m.current = "bank"; },
    checks: (m) => {
      const bal = (o: string) => num(m.peek("bank", `SELECT balance FROM accounts WHERE owner='${o}'`));
      return [
        { text: "You used ROLLBACK to undo a change", done: m.hasEvent("rollback") },
        { text: "You used COMMIT to keep a change", done: m.hasEvent("commit") },
        { text: "alice has 400 and bob has 400 (the transfer was committed)", done: bal("alice") === 400 && bal("bob") === 400 },
        { text: "The total is still 800: no money was lost", done: m.hasEvent("commit") && num(m.peek("bank", "SELECT SUM(balance) FROM accounts")) === 800 },
      ];
    },
  },
  {
    id: "foreign-keys", group: "Reliability", title: "Foreign keys and ON DELETE CASCADE", start: "client",
    brief: [
      "In a new database library create authors (id auto-increment PK, name) and books (id auto-increment PK, title, author_id NOT NULL) with a FOREIGN KEY from books.author_id to authors.id ON DELETE CASCADE.",
      "Insert authors and books, try to insert a book for an author that does not exist (it must fail), then delete an author and watch the author's books disappear.",
    ],
    hints: ["CREATE DATABASE library;", "USE library;", "CREATE TABLE authors (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL);", "CREATE TABLE books (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(80) NOT NULL, author_id INT NOT NULL, FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE);", "INSERT INTO authors (name) VALUES ('Tagore'), ('Premchand');", "INSERT INTO books (title, author_id) VALUES ('Gitanjali', 1), ('Godaan', 2), ('Gora', 1);", "INSERT INTO books (title, author_id) VALUES ('Orphan', 99);", "DELETE FROM authors WHERE id = 1;", "SELECT * FROM books;", "SHOW CREATE TABLE books\\G"],
    setup: () => {},
    checks: (m) => {
      const fk = m.tableMeta("library", "books")?.constraints.find((c) => /FOREIGN KEY/.test(c)) ?? "";
      return [
        { text: "Tables authors and books exist in library", done: !!m.tableMeta("library", "authors") && !!m.tableMeta("library", "books") },
        { text: "books.author_id has a FOREIGN KEY to authors(id) ON DELETE CASCADE", done: /`author_id`\)\s+REFERENCES\s+`authors`\s+\(`id`\)\s+ON DELETE CASCADE/.test(fk) },
        { text: "A book for a missing author was rejected (error 1452)", done: m.hasEvent("fk-violation") },
        { text: "Deleting an author also deleted that author's books (cascade)", done: m.hasEvent("cascade-delete") },
        { text: "No book points to a missing author", done: num(m.peek("library", "SELECT COUNT(*) FROM books WHERE author_id NOT IN (SELECT id FROM authors)")) === 0 && num(m.peek("library", "SELECT COUNT(*) FROM books")) > 0 },
      ];
    },
  },
  {
    id: "users", group: "Administration", title: "Users and privileges", start: "client",
    brief: [
      "You are root on a server with the shop database.",
      "1) Create the user 'report'@'localhost' (password Rep0rt!) who may only read everything in shop. 2) Create 'clerk'@'localhost' (password Cl3rk!) who may SELECT and INSERT on shop.customers only. 3) Drop the leftover user 'olduser'@'localhost'.",
      "Check with SHOW GRANTS FOR ..., then leave the client (exit) and log in as report: mariadb -u report -pRep0rt! shop. Prove that it can read but not insert.",
    ],
    hints: ["CREATE USER 'report'@'localhost' IDENTIFIED BY 'Rep0rt!';", "GRANT SELECT ON shop.* TO 'report'@'localhost';", "CREATE USER 'clerk'@'localhost' IDENTIFIED BY 'Cl3rk!';", "GRANT SELECT, INSERT ON shop.customers TO 'clerk'@'localhost';", "DROP USER 'olduser'@'localhost';", "SHOW GRANTS FOR 'report'@'localhost';", "SELECT user, host FROM mysql.user;", "FLUSH PRIVILEGES;", "exit", "mariadb -u report -pRep0rt! shop", "INSERT INTO customers (id, name, joined) VALUES (999, 'Test', '2025-01-01');"],
    setup: (m) => {
      loadShop(m);
      m.runSilent("CREATE USER 'olduser'@'localhost' IDENTIFIED BY 'old';");
    },
    checks: (m) => {
      const report = m.grantsOf("report").join("\n");
      const clerk = m.grantsOf("clerk").join("\n");
      return [
        { text: "User report@localhost exists", done: m.userExists("report") },
        { text: "report has SELECT on shop.* (and nothing more)", done: /GRANT SELECT ON `shop`\.\* TO `report`@`localhost`/.test(report) && !/INSERT|UPDATE|DELETE|ALL PRIVILEGES/.test(report) },
        { text: "clerk has SELECT, INSERT on shop.customers only", done: /GRANT SELECT, INSERT ON `shop`\.`customers` TO `clerk`@`localhost`/.test(clerk) },
        { text: "olduser was dropped", done: !m.userExists("olduser") },
        { text: "You logged in as report", done: m.hasEvent("login:report") },
        { text: "An INSERT as report was denied (error 1142)", done: m.hasEvent("denied:report") },
      ];
    },
  },
  {
    id: "backup", group: "Administration", title: "Backup and restore from the shell", start: "shell",
    brief: [
      "You are at the Linux shell (not inside the client). Practise the command-line tools:",
      "1) Dump the customers table of shop to backup.sql (mysqldump). 2) Create a database named restored with mysqladmin. 3) Load the dump into it (mysql restored < backup.sql).",
      "4) Check that restored.customers has as many rows as shop.customers, using mysql -e. 5) Run mysqladmin status.",
    ],
    hints: ["sudo mysql -e 'SHOW DATABASES'", "mysqldump -u root shop customers > backup.sql", "ls", "head -n 12 backup.sql", "mysqladmin -u root create restored", "mysql -u root restored < backup.sql", "mysql -u root -e 'SELECT COUNT(*) FROM shop.customers'", "mysql -u root restored -e 'SELECT COUNT(*) FROM customers'", "mysqladmin -u root status", "sudo mysql"],
    setup: (m) => { loadShop(m); m.startInShell(); },
    checks: (m) => {
      const dump = m.files["backup.sql"] ?? "";
      const a = num(m.peek("shop", "SELECT COUNT(*) FROM customers"));
      return [
        { text: "backup.sql contains CREATE TABLE and INSERT for customers", done: /CREATE TABLE `customers`/.test(dump) && /INSERT INTO `customers`/.test(dump) },
        { text: "Database restored exists (mysqladmin create)", done: m.hasDatabase("restored") },
        { text: "The dump was loaded into restored", done: m.hasEvent("restore") && !!m.tableMeta("restored", "customers") },
        { text: "restored.customers has the same number of rows as shop.customers", done: a > 0 && num(m.peek("restored", "SELECT COUNT(*) FROM customers")) === a },
        { text: "You ran a query with mysql -e", done: m.hasEvent("mysql-e") },
        { text: "You ran mysqladmin status", done: m.hasEvent("mysqladmin-status") },
      ];
    },
  },
];

export const MARIA_GROUPS = [...new Set(MARIA_EXERCISES.map((e) => e.group))];
export const mariaExerciseById = (id: string) => MARIA_EXERCISES.find((e) => e.id === id) ?? MARIA_EXERCISES[0];

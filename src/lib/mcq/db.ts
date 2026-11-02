import { build, type Row } from "./types";

const EMP = `Table Employees
EmpID | Name    | Position | DeptID
1     | Alice   | Manager  | 10
2     | Bob     | Engineer | 20
3     | Charlie | Engineer | 20
4     | David   | Analyst  | 10
5     | Eva     | Manager  | 30`;

const rows: Row[] = [
  ["What does ACID stand for in database transactions?", ["Atomicity, Consistency, Isolation, Durability", "Accuracy, Consistency, Integrity, Durability", "Atomicity, Concurrency, Isolation, Data", "Availability, Consistency, Isolation, Durability"], "A", "ACID are the four properties that make transactions reliable."],
  ["Which ACID property ensures that a transaction is either completely done or not done at all?", ["Atomicity", "Consistency", "Isolation", "Durability"], "A", "All-or-nothing."],
  ["Which ACID property ensures that committed data survives a crash?", ["Atomicity", "Consistency", "Isolation", "Durability"], "D", "Durability: committed changes are permanent."],
  ["Which SQL command makes the changes of a transaction permanent?", ["SAVE", "COMMIT", "ROLLBACK", "APPLY"], "B", "ROLLBACK undoes them instead."],
  ["Which SQL command undoes the changes made by the current transaction?", ["UNDO", "ROLLBACK", "RESET", "REVERT"], "B", "ROLLBACK returns to the state at the start of the transaction (or to a SAVEPOINT)."],
  ["A key that uniquely identifies each row of a table and cannot be NULL is called the:", ["Foreign key", "Primary key", "Candidate key only", "Composite index"], "B", "A table has at most one primary key."],
  ["A column in one table that refers to the primary key of another table is a:", ["Primary key", "Foreign key", "Super key", "Unique index"], "B", "Foreign keys enforce referential integrity."],
  ["Which normal form removes partial dependencies on a part of a composite key?", ["1NF", "2NF", "3NF", "BCNF"], "B", "2NF: no non-key attribute depends on only part of the key."],
  ["Which normal form removes transitive dependencies between non-key attributes?", ["1NF", "2NF", "3NF", "None of them"], "C", "3NF: non-key attributes depend only on the key."],
  ["A table is in First Normal Form (1NF) if:", ["Every column holds atomic (indivisible) values", "It has no foreign key", "It has an index on every column", "It has only one row"], "A", "No repeating groups or multi-valued cells."],
  ["Which SQL clause filters groups created by GROUP BY?", ["WHERE", "HAVING", "ORDER BY", "LIMIT"], "B", "WHERE filters rows before grouping; HAVING filters groups after."],
  ["Which of the following is NOT an aggregate function in SQL?", ["SUM()", "AVG()", "COUNT()", "CONCAT()"], "D", "CONCAT joins strings row by row; it is not an aggregate."],
  ["Which statement about COUNT(column) is TRUE?", ["It counts NULL values too", "It ignores NULL values in that column", "It always equals COUNT(*)", "It works only on numbers"], "B", "COUNT(*) counts all rows; COUNT(col) counts non-NULL values."],
  ["Which of the following is a DDL command?", ["SELECT", "INSERT", "CREATE", "COMMIT"], "C", "DDL defines structure: CREATE, ALTER, DROP, TRUNCATE."],
  ["Which of the following is a DML command?", ["CREATE", "UPDATE", "GRANT", "DROP"], "B", "DML manipulates data: INSERT, UPDATE, DELETE (SELECT is often grouped with it)."],
  ["Which of the following is a DCL (Data Control Language) command?", ["GRANT", "SELECT", "ALTER", "DELETE"], "A", "DCL: GRANT and REVOKE."],
  ["Which of the following is a TCL (Transaction Control) command?", ["SAVEPOINT", "CREATE", "INSERT", "GRANT"], "A", "TCL: COMMIT, ROLLBACK, SAVEPOINT."],
  ["What is the difference between DELETE and TRUNCATE in MariaDB?", ["TRUNCATE removes all rows quickly (and resets AUTO_INCREMENT); DELETE can remove selected rows with WHERE", "DELETE removes the table structure", "TRUNCATE can have a WHERE clause", "There is no difference"], "A", "TRUNCATE TABLE is DDL: no WHERE, resets the counter."],
  ["Which SQL statement removes the table structure together with its data?", ["DELETE FROM t;", "TRUNCATE TABLE t;", "DROP TABLE t;", "REMOVE t;"], "C", "DROP TABLE deletes the table itself."],
  ["Which operator selects values within a range, including both ends?", ["IN", "BETWEEN", "LIKE", "EXISTS"], "B", "x BETWEEN 10 AND 20 means x >= 10 AND x <= 20."],
  ["Which SQL operator tests whether a column value is missing?", ["= NULL", "IS NULL", "== NULL", "EMPTY"], "B", "Comparisons with = NULL are never true; use IS NULL."],
  ["What is the difference between UNION and UNION ALL?", ["UNION removes duplicate rows; UNION ALL keeps them", "UNION ALL removes duplicates", "UNION works on one table only", "There is no difference"], "A", "UNION ALL is faster because it does not remove duplicates."],
  ["Which query returns the three highest salaries in the table staff(name, salary)?", ["SELECT salary FROM staff ORDER BY salary DESC LIMIT 3;", "SELECT TOP 3 salary FROM staff;", "SELECT salary FROM staff LIMIT 3 ORDER BY salary;", "SELECT 3 salary FROM staff;"], "A", "MariaDB/MySQL use LIMIT; TOP is SQL Server syntax."],
  ["What is the default storage engine of recent MariaDB versions?", ["MyISAM", "InnoDB", "MEMORY", "CSV"], "B", "InnoDB (MyISAM was the default in very old MySQL)."],
  ["Which MariaDB storage engine uses table-level locking and does not support transactions?", ["InnoDB", "MyISAM", "Both", "None"], "B", "MyISAM has no transactions or foreign keys."],
  ["What is the default TCP port of MariaDB/MySQL?", ["1433", "3306", "5432", "27017"], "B", "1433 is SQL Server, 5432 PostgreSQL, 27017 MongoDB."],
  ["Which statement lists all databases on a MariaDB server?", ["LIST DATABASES;", "SHOW DATABASES;", "SELECT DATABASES;", "DISPLAY DATABASES;"], "B", "SHOW DATABASES;"],
  ["Which statement selects the database to work with in the mysql/mariadb client?", ["USE dbname;", "SELECT dbname;", "OPEN dbname;", "CONNECT dbname;"], "A", "USE dbname;"],
  ["Which statement shows the columns of the table 'students'?", ["DESCRIBE students;", "SHOW students;", "LIST students;", "STRUCTURE students;"], "A", "DESCRIBE (or DESC) students; or SHOW COLUMNS FROM students;"],
  ["Which column attribute makes MariaDB generate the next number automatically for a new row?", ["AUTO_INCREMENT", "AUTONUMBER", "IDENTITY", "SERIAL_NEXT"], "A", "MariaDB uses AUTO_INCREMENT; SQL Server uses IDENTITY."],
  ["Which statement creates a new user in MariaDB?", ["CREATE USER 'ann'@'localhost' IDENTIFIED BY 'secret';", "ADD USER ann PASSWORD 'secret';", "NEW USER ann = 'secret';", "INSERT USER ann;"], "A", "CREATE USER 'name'@'host' IDENTIFIED BY 'password';"],
  ["Which statement takes away a privilege from a user?", ["REVOKE", "DENYALL", "REMOVE GRANT", "DROP PRIVILEGE"], "A", "REVOKE SELECT ON db.* FROM 'user'@'host';"],
  ["Which statement shows the privileges of a MariaDB user?", ["SHOW GRANTS FOR 'ann'@'localhost';", "SHOW PRIVILEGES ann;", "LIST GRANTS ann;", "DESCRIBE USER ann;"], "A", "SHOW GRANTS FOR user;"],
  ["Which command is typically used after editing the grant tables directly, to reload the privileges?", ["FLUSH PRIVILEGES;", "RELOAD USERS;", "REFRESH GRANTS;", "COMMIT;"], "A", "GRANT and CREATE USER already take effect without it."],
  ["Which mysqldump option dumps ONE OR MORE complete databases and adds CREATE DATABASE statements?", ["--databases", "--tables-only", "--all-structures", "--with-create"], "A", "mysqldump --databases shop school > backup.sql"],
  ["Which command creates a database named 'lab' from the operating-system shell?", ["mysqladmin -u root -p create lab", "mysql create lab", "mysqldump lab", "mariadb --new lab"], "A", "mysqladmin create dbname (or CREATE DATABASE lab; inside the client)."],
  ["Which SQL statement lists the tables of the current database?", ["SHOW TABLES;", "LIST TABLES;", "SELECT TABLES;", "DESCRIBE DATABASE;"], "A", "SHOW TABLES;"],
  ["Which function returns the current date (without time) in MariaDB?", ["NOW()", "CURDATE()", "TODAY()", "DATE_NOW()"], "B", "CURDATE() returns only the date; NOW() returns date and time."],
  ["Which function returns the first non-NULL of its arguments?", ["COALESCE()", "NVL2()", "FIRSTVAL()", "ISNULL() only"], "A", "IFNULL(a, b) is the two-argument MariaDB version."],
  ["What does SELECT IFNULL(NULL, 'x'); return?", ["NULL", "x", "0", "An error"], "B", "IFNULL returns the second argument when the first is NULL."],
  ["Which statement adds a new column to an existing table in MariaDB?", ["ALTER TABLE t ADD COLUMN c INT;", "UPDATE TABLE t ADD c INT;", "INSERT COLUMN c INT INTO t;", "CHANGE TABLE t ADD c INT;"], "A", "ALTER TABLE changes the structure."],
  ["Which statement creates an index on the column last_name of the table employees?", ["CREATE INDEX idx_last ON employees(last_name);", "INDEX employees(last_name);", "ADD INDEX last_name ON employees;", "MAKE INDEX employees.last_name;"], "A", "CREATE INDEX name ON table(column);"],
  ["Which statement in MariaDB shows how the server executes a SELECT query (indexes used, rows examined)?", ["EXPLAIN SELECT ...", "SHOW PLAN SELECT ...", "ANALYZE ONLY SELECT ...", "DESCRIBE QUERY ..."], "A", "EXPLAIN prints the access plan: type, key, rows, Extra."],
  ["In EXPLAIN output, the access type 'ALL' means:", ["A full table scan", "All indexes are used", "All columns are selected", "The query is cached"], "A", "type = ALL reads every row; an index is missing or unused."],
  ["A stored procedure is executed with the statement:", ["CALL procedure_name();", "RUN procedure_name;", "EXEC procedure_name();", "START procedure_name;"], "A", "In MariaDB/MySQL stored procedures are run with CALL."],
  ["A trigger can be defined to fire at which of the following times?", ["BEFORE or AFTER an INSERT, UPDATE or DELETE", "Only AFTER SELECT", "Only at server start", "Only on CREATE TABLE"], "A", "Triggers are tied to row changes on one table."],
  ["Which type of relationship needs a junction (linking) table when converted to relational tables?", ["One-to-one", "One-to-many", "Many-to-many", "None"], "C", "A student can take many courses and a course has many students: an enrolment table links them."],
  ["Which transaction isolation level in MariaDB InnoDB is the default?", ["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"], "C", "InnoDB defaults to REPEATABLE READ."],
  ["What does ON DELETE CASCADE mean for a foreign key?", ["When the parent row is deleted, the child rows are deleted too", "The parent cannot be deleted", "The child rows are set to 0", "Nothing happens to the child rows"], "A", "Other options: RESTRICT, SET NULL, NO ACTION."],
  ["Which SQL statement returns all employees whose name starts with the letter A?", ["SELECT * FROM emp WHERE name LIKE 'A%';", "SELECT * FROM emp WHERE name = 'A*';", "SELECT * FROM emp WHERE name STARTS 'A';", "SELECT * FROM emp WHERE name LIKE '%A';"], "A", "'A%' = begins with A; '%A' = ends with A."],
  ["Using the table below, how many rows does 'SELECT DISTINCT Position FROM Employees;' return?", ["2", "3", "4", "5"], "B", "The distinct positions are Manager, Engineer and Analyst.", EMP],
  ["Using the table below, what does 'SELECT COUNT(*) FROM Employees WHERE DeptID = 10;' return?", ["1", "2", "3", "5"], "B", "Alice and David are in department 10.", EMP],
  ["Using the table below, which DeptID values does 'SELECT DeptID FROM Employees GROUP BY DeptID HAVING COUNT(*) > 1;' return?", ["10 and 20", "10 only", "20 only", "10, 20 and 30"], "A", "Departments 10 and 20 have two employees each; 30 has one.", EMP],
];

export const DB_QUESTIONS = build("db", "db-", rows);

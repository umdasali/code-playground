// Deterministic sample dataset shared by the browser (SQLite) and server (MySQL) engines.
// Tables: departments, employees, customers, categories, products, orders, order_items, reviews.
export type Dialect = "sqlite" | "mysql";

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replaceAll("'", "''")}'`);
const date = (base: string, days: number) => new Date(Date.parse(base) + days * 86_400_000).toISOString().slice(0, 10);
const insert = (table: string, rows: (string | number | null)[][]) =>
  `INSERT INTO ${table} VALUES\n${rows.map((r) => `(${r.map(q).join(",")})`).join(",\n")};`;

const FIRST = ["Asha", "Ben", "Chen", "Dana", "Eli", "Fatima", "Gabe", "Hana", "Ivan", "Jia", "Kofi", "Lena", "Mateo", "Nina", "Omar", "Priya", "Quinn", "Ravi", "Sofia", "Tariq", "Uma", "Victor", "Wen", "Ximena", "Yusuf", "Zara"];
const LAST = ["Sharma", "Miller", "Wang", "Fischer", "Cohen", "Khan", "Silva", "Tanaka", "Petrov", "Lin", "Mensah", "Berg", "Garcia", "Rossi", "Haddad", "Patel", "Nguyen", "Okafor", "Novak", "Lopez"];
const CITIES: [string, string][] = [["Pune", "India"], ["Austin", "USA"], ["Shanghai", "China"], ["Berlin", "Germany"], ["Lagos", "Nigeria"], ["Toronto", "Canada"], ["Madrid", "Spain"], ["Osaka", "Japan"], ["Denver", "USA"], ["Lyon", "France"]];

const DEPARTMENTS: [number, string, string][] = [[1, "Executive", "Berlin"], [2, "Engineering", "Pune"], [3, "Sales", "Austin"], [4, "Marketing", "Toronto"], [5, "Support", "Lagos"], [6, "Finance", "Madrid"]];
const CATEGORIES = ["Accessories", "Displays", "Computers", "Audio", "Storage", "Networking"];
const PRODUCTS: [string, number, number][] = [
  ["Keyboard", 0, 49.99], ["Mouse", 0, 19.5], ["Webcam", 0, 59.9], ["USB Hub", 0, 24.0], ["Laptop Stand", 0, 34.5],
  ["Monitor 24in", 1, 189.0], ["Monitor 27in", 1, 279.0], ["Ultrawide Monitor", 1, 549.0], ["Portable Display", 1, 229.0],
  ["Laptop Pro", 2, 1499.0], ["Laptop Air", 2, 999.0], ["Mini Desktop", 2, 649.0], ["Tablet", 2, 429.0], ["Workstation", 2, 2399.0],
  ["Headphones", 3, 129.0], ["Earbuds", 3, 79.0], ["Speaker", 3, 99.0], ["Microphone", 3, 119.0], ["Soundbar", 3, 199.0],
  ["SSD 1TB", 4, 89.0], ["SSD 2TB", 4, 159.0], ["External HDD", 4, 74.0], ["Flash Drive", 4, 12.5], ["Memory Card", 4, 18.0],
  ["Router", 5, 89.0], ["Mesh Wi-Fi", 5, 249.0], ["Ethernet Switch", 5, 45.0], ["Network Cable", 5, 9.0], ["Wi-Fi Extender", 5, 39.0], ["Firewall Box", 5, 329.0],
];
const STATUSES = ["pending", "shipped", "delivered", "delivered", "delivered", "cancelled"];
const COMMENTS = ["Great value", "Works as expected", "Stopped working after a month", "Excellent quality", "Too expensive", "Fast delivery", "Not as described", "Would buy again"];

export function buildSampleSql(d: Dialect): string {
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const money = d === "mysql" ? "DECIMAL(10,2)" : "REAL";
  const text = (n: number) => (d === "mysql" ? `VARCHAR(${n})` : "TEXT");

  const ddl = [
    `CREATE TABLE departments (id INT PRIMARY KEY, name ${text(40)} NOT NULL, location ${text(40)});`,
    `CREATE TABLE employees (id INT PRIMARY KEY, name ${text(60)} NOT NULL, department_id INT NOT NULL, manager_id INT NULL, title ${text(40)}, salary ${money} NOT NULL, hire_date DATE NOT NULL, FOREIGN KEY (department_id) REFERENCES departments(id), FOREIGN KEY (manager_id) REFERENCES employees(id));`,
    `CREATE TABLE customers (id INT PRIMARY KEY, name ${text(60)} NOT NULL, email ${text(80)}, city ${text(40)}, country ${text(40)}, joined DATE NOT NULL);`,
    `CREATE TABLE categories (id INT PRIMARY KEY, name ${text(40)} NOT NULL);`,
    `CREATE TABLE products (id INT PRIMARY KEY, name ${text(60)} NOT NULL, category_id INT NOT NULL, price ${money} NOT NULL, stock INT NOT NULL, FOREIGN KEY (category_id) REFERENCES categories(id));`,
    `CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT NOT NULL, ordered_at DATE NOT NULL, status ${text(20)} NOT NULL, FOREIGN KEY (customer_id) REFERENCES customers(id));`,
    `CREATE TABLE order_items (order_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, unit_price ${money} NOT NULL, PRIMARY KEY (order_id, product_id), FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id));`,
    `CREATE TABLE reviews (id INT PRIMARY KEY, product_id INT NOT NULL, customer_id INT NOT NULL, rating INT NOT NULL, comment ${text(120)} NULL, created_at DATE NOT NULL, FOREIGN KEY (product_id) REFERENCES products(id), FOREIGN KEY (customer_id) REFERENCES customers(id));`,
  ];

  // Employees: #1 is the CEO (no manager); everyone else reports to an earlier employee.
  const titles = ["Engineer", "Senior Engineer", "Account Executive", "Marketing Specialist", "Support Agent", "Accountant"];
  const employees = Array.from({ length: 30 }, (_, i) => {
    const id = i + 1;
    const dept = id === 1 ? 1 : int(2, 6);
    return [id, `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`, dept, id === 1 ? null : id <= 6 ? 1 : int(2, Math.min(id - 1, 12)),
      id === 1 ? "CEO" : titles[dept - 2], id === 1 ? 250000 : int(38, 140) * 1000, date("2015-01-01", int(0, 3400))] as (string | number | null)[];
  });

  // Customers: the last 5 never order, so LEFT JOIN / NOT EXISTS exercises have something to find.
  const customers = Array.from({ length: 40 }, (_, i) => {
    const [city, country] = pick(CITIES);
    const name = `${FIRST[(i * 3) % FIRST.length]} ${LAST[(i * 5 + 1) % LAST.length]}`;
    return [i + 1, name, i % 9 === 8 ? null : `${name.toLowerCase().replace(" ", ".")}${i}@example.com`, city, country, date("2022-01-01", int(0, 1000))];
  });

  const products = PRODUCTS.map(([name, cat, price], i) => [i + 1, name, cat + 1, price, i % 11 === 10 ? 0 : int(5, 200)]);

  const orders: (string | number)[][] = [];
  const items: (string | number)[][] = [];
  for (let id = 1; id <= 120; id++) {
    orders.push([id, int(1, 35), date("2024-01-01", int(0, 600)), pick(STATUSES)]);
    const seen = new Set<number>();
    for (let n = int(1, 4); n > 0; n--) {
      const pid = int(1, 27); // products 28-30 never sell
      if (seen.has(pid)) continue;
      seen.add(pid);
      items.push([id, pid, int(1, 5), PRODUCTS[pid - 1][2]]);
    }
  }

  const reviews = Array.from({ length: 80 }, (_, i) => [i + 1, int(1, 27), int(1, 35), int(1, 5), i % 6 === 5 ? null : pick(COMMENTS), date("2024-02-01", int(0, 600))]);

  return [
    ...(d === "sqlite" ? ["PRAGMA foreign_keys = ON;"] : []),
    ...ddl,
    insert("departments", DEPARTMENTS),
    insert("employees", employees),
    insert("customers", customers),
    insert("categories", CATEGORIES.map((n, i) => [i + 1, n])),
    insert("products", products),
    insert("orders", orders),
    insert("order_items", items),
    insert("reviews", reviews),
  ].join("\n");
}

export const SAMPLE_TABLES = "departments, employees, customers, categories, products, orders, order_items, reviews";

// Practice prompts: written in standard SQL so they run on both engines.
export const EXERCISES: { title: string; sql: string }[] = [
  { title: "Basics: top 5 most expensive products", sql: "SELECT name, price FROM products ORDER BY price DESC LIMIT 5;" },
  { title: "Filter: customers from the USA", sql: "SELECT name, city FROM customers WHERE country = 'USA' ORDER BY name;" },
  { title: "NULLs: customers without an email", sql: "SELECT id, name FROM customers WHERE email IS NULL;" },
  { title: "Aggregate: average salary per department", sql: "SELECT d.name, COUNT(*) AS headcount, ROUND(AVG(e.salary), 0) AS avg_salary\nFROM employees e JOIN departments d ON d.id = e.department_id\nGROUP BY d.id, d.name\nORDER BY avg_salary DESC;" },
  { title: "HAVING: customers with 4+ orders", sql: "SELECT c.name, COUNT(*) AS orders\nFROM customers c JOIN orders o ON o.customer_id = c.id\nGROUP BY c.id, c.name\nHAVING COUNT(*) >= 4\nORDER BY orders DESC;" },
  { title: "LEFT JOIN: customers who never ordered", sql: "SELECT c.id, c.name\nFROM customers c LEFT JOIN orders o ON o.customer_id = c.id\nWHERE o.id IS NULL;" },
  { title: "Self join: employee and their manager", sql: "SELECT e.name AS employee, m.name AS manager\nFROM employees e LEFT JOIN employees m ON m.id = e.manager_id\nORDER BY manager, employee;" },
  { title: "Join x4: revenue per category", sql: "SELECT c.name AS category, SUM(oi.qty * oi.unit_price) AS revenue\nFROM order_items oi\nJOIN products p ON p.id = oi.product_id\nJOIN categories c ON c.id = p.category_id\nJOIN orders o ON o.id = oi.order_id\nWHERE o.status <> 'cancelled'\nGROUP BY c.id, c.name\nORDER BY revenue DESC;" },
  { title: "Subquery: products priced above average", sql: "SELECT name, price FROM products\nWHERE price > (SELECT AVG(price) FROM products)\nORDER BY price;" },
  { title: "NOT EXISTS: products never ordered", sql: "SELECT p.name FROM products p\nWHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id);" },
  { title: "CASE: bucket products by price", sql: "SELECT name, price,\n  CASE WHEN price < 50 THEN 'budget' WHEN price < 300 THEN 'mid' ELSE 'premium' END AS tier\nFROM products ORDER BY price;" },
  { title: "CTE: top spender per country", sql: "WITH spend AS (\n  SELECT c.id, c.name, c.country, SUM(oi.qty * oi.unit_price) AS total\n  FROM customers c JOIN orders o ON o.customer_id = c.id\n  JOIN order_items oi ON oi.order_id = o.id\n  GROUP BY c.id, c.name, c.country\n)\nSELECT country, name, total FROM spend s\nWHERE total = (SELECT MAX(total) FROM spend WHERE country = s.country)\nORDER BY total DESC;" },
  { title: "Window: rank employees by salary in department", sql: "SELECT name, department_id, salary,\n  RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS dept_rank\nFROM employees ORDER BY department_id, dept_rank;" },
  { title: "Window: running total of orders by date", sql: "SELECT ordered_at, COUNT(*) AS orders,\n  SUM(COUNT(*)) OVER (ORDER BY ordered_at) AS running_total\nFROM orders GROUP BY ordered_at ORDER BY ordered_at LIMIT 20;" },
  { title: "Reviews: average rating, only 3+ reviews", sql: "SELECT p.name, COUNT(*) AS reviews, ROUND(AVG(r.rating), 2) AS avg_rating\nFROM reviews r JOIN products p ON p.id = r.product_id\nGROUP BY p.id, p.name HAVING COUNT(*) >= 3\nORDER BY avg_rating DESC;" },
  { title: "DML: raise Sales salaries by 5%", sql: "UPDATE employees SET salary = salary * 1.05\nWHERE department_id = (SELECT id FROM departments WHERE name = 'Sales');\nSELECT name, salary FROM employees WHERE department_id = 3;" },
  { title: "DML: delete cancelled orders' items", sql: "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE status = 'cancelled');\nSELECT COUNT(*) AS remaining_items FROM order_items;" },
];

export type TabId = "c" | "cpp" | "bash" | "terminal" | "mysql" | "web" | "network" | "mariadb";

export interface TabConfig {
  id: TabId;
  label: string;
  monaco: string;
  starter: string;
}

export const TABS: TabConfig[] = [
  {
    id: "c",
    label: "C",
    monaco: "c",
    starter: `#include <stdio.h>

int main(void) {
    printf("Hello from C!\\n");
    return 0;
}
`,
  },
  {
    id: "cpp",
    label: "C++",
    monaco: "cpp",
    starter: `#include <iostream>
#include <string>
#include <vector>

struct Point {
    double x, y;
    Point operator+(const Point &o) const { return {x + o.x, y + o.y}; }
};

template <typename T>
T square(T v) { return v * v; }

int main() {
    Point p = Point{1.5, 2.0} + Point{2.5, 1.0};
    auto twice = [](int n) { return n * 2; };
    std::vector<std::string> words = {"Hello", "from", "C++!"};

    for (const std::string &w : words) std::cout << w << ' ';
    std::cout << "\\n";
    std::cout << "p = (" << p.x << ", " << p.y << ")\\n";
    std::cout << "square(7) = " << square(7) << ", twice(21) = " << twice(21) << "\\n";
    return 0;
}
`,
  },
  {
    id: "bash",
    label: "Bash",
    monaco: "shell",
    starter: `#!/usr/bin/env bash
name="world"
echo "Hello, $name!"
for i in 1 2 3; do
  echo "count: $i"
done
uname -a
`,
  },
  {
    id: "terminal",
    label: "Terminal",
    monaco: "shell",
    starter: "",
  },
  {
    id: "web",
    label: "HTML/CSS/JS",
    monaco: "html",
    starter: "",
  },
  {
    id: "mariadb",
    label: "MariaDB",
    monaco: "sql",
    starter: "",
  },
  {
    id: "network",
    label: "Network",
    monaco: "plaintext",
    starter: "",
  },
  {
    id: "mysql",
    label: "SQL",
    monaco: "sql",
    starter: `-- Click "Load sample data" to get shop tables, then try:
SELECT c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id
ORDER BY orders DESC;
`,
  },
];

export const RUN_LIMITS = { code: 20_000, stdin: 4_000 };

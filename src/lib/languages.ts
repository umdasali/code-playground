export type TabId = "c" | "cpp" | "bash" | "terminal" | "mysql" | "web";

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
#include <vector>

int main() {
    std::vector<int> v{1, 2, 3};
    int sum = 0;
    for (int x : v) sum += x;
    std::cout << "Hello from C++! sum=" << sum << "\\n";
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
    id: "mysql",
    label: "MySQL",
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

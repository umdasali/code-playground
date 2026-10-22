export interface Example {
  title: string;
  category: string;
  code: string;
  stdin?: string;
}

export const C_EXAMPLES: Example[] = [
  {
    category: "Basics", title: "Hello, World",
    code: `#include <stdio.h>

int main(void) {
    printf("Hello, World!\\n");
    return 0;
}
`,
  },
  {
    category: "Basics", title: "Input and arithmetic", stdin: "17 5",
    code: `#include <stdio.h>

int main(void) {
    int a, b;
    printf("Enter two integers: ");
    if (scanf("%d %d", &a, &b) != 2) { puts("bad input"); return 1; }

    printf("sum        = %d\\n", a + b);
    printf("difference = %d\\n", a - b);
    printf("product    = %d\\n", a * b);
    printf("quotient   = %d\\n", a / b);        // integer division
    printf("remainder  = %d\\n", a % b);
    printf("real div   = %.3f\\n", (double)a / b);
    return 0;
}
`,
  },
  {
    category: "Basics", title: "Data types and sizes",
    code: `#include <stdio.h>
#include <limits.h>
#include <float.h>

int main(void) {
    printf("char   : %zu byte,  max %d\\n", sizeof(char), CHAR_MAX);
    printf("short  : %zu bytes, max %d\\n", sizeof(short), SHRT_MAX);
    printf("int    : %zu bytes, max %d\\n", sizeof(int), INT_MAX);
    printf("long   : %zu bytes, max %ld\\n", sizeof(long), LONG_MAX);
    printf("float  : %zu bytes, eps %g\\n", sizeof(float), FLT_EPSILON);
    printf("double : %zu bytes, eps %g\\n", sizeof(double), DBL_EPSILON);
    printf("pointer: %zu bytes\\n", sizeof(void *));
    return 0;
}
`,
  },
  {
    category: "Control flow", title: "FizzBuzz",
    code: `#include <stdio.h>

int main(void) {
    for (int i = 1; i <= 30; i++) {
        if (i % 15 == 0)      puts("FizzBuzz");
        else if (i % 3 == 0)  puts("Fizz");
        else if (i % 5 == 0)  puts("Buzz");
        else                  printf("%d\\n", i);
    }
    return 0;
}
`,
  },
  {
    category: "Control flow", title: "Multiplication table", stdin: "7",
    code: `#include <stdio.h>

int main(void) {
    int n;
    printf("Table of: ");
    scanf("%d", &n);
    for (int i = 1; i <= 10; i++)
        printf("%d x %2d = %3d\\n", n, i, n * i);
    return 0;
}
`,
  },
  {
    category: "Control flow", title: "Prime numbers",
    code: `#include <stdio.h>
#include <stdbool.h>

static bool is_prime(int n) {
    if (n < 2) return false;
    for (int d = 2; d * d <= n; d++)
        if (n % d == 0) return false;
    return true;
}

int main(void) {
    printf("Primes up to 60:");
    for (int i = 2; i <= 60; i++)
        if (is_prime(i)) printf(" %d", i);
    printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Functions", title: "Recursion: factorial and Fibonacci",
    code: `#include <stdio.h>

unsigned long long factorial(int n) { return n <= 1 ? 1 : n * factorial(n - 1); }
int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

int main(void) {
    for (int i = 0; i <= 10; i++)
        printf("%2d! = %llu\\n", i, factorial(i));
    printf("fib:");
    for (int i = 0; i < 15; i++) printf(" %d", fib(i));
    printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Arrays and strings", title: "Array statistics",
    code: `#include <stdio.h>

int main(void) {
    int a[] = {42, 7, 19, 88, 3, 56, 21};
    int n = sizeof a / sizeof a[0];
    int min = a[0], max = a[0], sum = 0;

    for (int i = 0; i < n; i++) {
        if (a[i] < min) min = a[i];
        if (a[i] > max) max = a[i];
        sum += a[i];
    }
    printf("n=%d min=%d max=%d avg=%.2f\\n", n, min, max, (double)sum / n);

    printf("reversed:");
    for (int i = n - 1; i >= 0; i--) printf(" %d", a[i]);
    printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Arrays and strings", title: "Strings: palindrome and vowels", stdin: "racecar",
    code: `#include <stdio.h>
#include <string.h>
#include <ctype.h>

int main(void) {
    char s[100];
    printf("Enter a word: ");
    scanf("%99s", s);

    int len = (int)strlen(s), pal = 1, vowels = 0;
    for (int i = 0; i < len / 2; i++)
        if (tolower((unsigned char)s[i]) != tolower((unsigned char)s[len - 1 - i])) pal = 0;
    for (int i = 0; i < len; i++)
        if (strchr("aeiouAEIOU", s[i])) vowels++;

    printf("length=%d vowels=%d palindrome=%s\\n", len, vowels, pal ? "yes" : "no");
    return 0;
}
`,
  },
  {
    category: "Arrays and strings", title: "Matrix multiplication",
    code: `#include <stdio.h>

#define N 3

int main(void) {
    int a[N][N] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
    int b[N][N] = {{9, 8, 7}, {6, 5, 4}, {3, 2, 1}};
    int c[N][N] = {0};

    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            for (int k = 0; k < N; k++)
                c[i][j] += a[i][k] * b[k][j];

    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) printf("%4d", c[i][j]);
        printf("\\n");
    }
    return 0;
}
`,
  },
  {
    category: "Pointers and memory", title: "Pointers: swap and arithmetic",
    code: `#include <stdio.h>

void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }

int main(void) {
    int a = 10, b = 20;
    swap(&a, &b);
    printf("after swap: a=%d b=%d\\n", a, b);

    int arr[] = {10, 20, 30, 40};
    int *p = arr;
    for (int i = 0; i < 4; i++)
        printf("*(p+%d) = %d  at %p\\n", i, *(p + i), (void *)(p + i));
    printf("p[3] - p[0] = %d, pointer distance = %td elements\\n", p[3] - p[0], (p + 3) - p);
    return 0;
}
`,
  },
  {
    category: "Pointers and memory", title: "Dynamic array (malloc / realloc / free)",
    code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    size_t cap = 2, len = 0;
    int *v = malloc(cap * sizeof *v);
    if (!v) return 1;

    for (int i = 1; i <= 10; i++) {
        if (len == cap) {                       // grow when full
            cap *= 2;
            int *tmp = realloc(v, cap * sizeof *v);
            if (!tmp) { free(v); return 1; }
            v = tmp;
            printf("grew to capacity %zu\\n", cap);
        }
        v[len++] = i * i;
    }
    for (size_t i = 0; i < len; i++) printf("%d ", v[i]);
    printf("\\n");
    free(v);
    return 0;
}
`,
  },
  {
    category: "Pointers and memory", title: "Linked list",
    code: `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

Node *push_front(Node *head, int v) {
    Node *n = malloc(sizeof *n);
    n->value = v;
    n->next = head;
    return n;
}

Node *reverse(Node *head) {
    Node *prev = NULL;
    while (head) { Node *next = head->next; head->next = prev; prev = head; head = next; }
    return prev;
}

void print(const Node *n) {
    for (; n; n = n->next) printf("%d -> ", n->value);
    puts("NULL");
}

int main(void) {
    Node *list = NULL;
    for (int i = 1; i <= 5; i++) list = push_front(list, i);
    print(list);
    list = reverse(list);
    print(list);
    while (list) { Node *t = list->next; free(list); list = t; }
    return 0;
}
`,
  },
  {
    category: "Data structures", title: "Structs: student records",
    code: `#include <stdio.h>
#include <string.h>

typedef struct {
    char name[32];
    int age;
    double gpa;
} Student;

int main(void) {
    Student s[3] = {
        {"Asha", 20, 3.8},
        {"Ben", 22, 3.1},
        {"Chen", 21, 3.5},
    };
    double total = 0;
    for (int i = 0; i < 3; i++) {
        printf("%-6s age %d gpa %.1f\\n", s[i].name, s[i].age, s[i].gpa);
        total += s[i].gpa;
    }
    printf("average gpa: %.2f\\n", total / 3);
    return 0;
}
`,
  },
  {
    category: "Data structures", title: "Sorting: bubble sort and qsort",
    code: `#include <stdio.h>
#include <stdlib.h>

static void print(const char *label, const int *a, int n) {
    printf("%s:", label);
    for (int i = 0; i < n; i++) printf(" %d", a[i]);
    printf("\\n");
}

static int cmp(const void *x, const void *y) { return *(const int *)x - *(const int *)y; }

int main(void) {
    int a[] = {64, 34, 25, 12, 22, 11, 90};
    int n = sizeof a / sizeof a[0];
    int b[7];
    for (int i = 0; i < n; i++) b[i] = a[i];

    for (int i = 0; i < n - 1; i++)                 // bubble sort
        for (int j = 0; j < n - 1 - i; j++)
            if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
    print("bubble", a, n);

    qsort(b, n, sizeof b[0], cmp);                  // library sort
    print("qsort ", b, n);
    return 0;
}
`,
  },
  {
    category: "Other", title: "File I/O: write then read",
    code: `#include <stdio.h>

int main(void) {
    FILE *f = fopen("data.txt", "w");
    if (!f) { perror("fopen"); return 1; }
    for (int i = 1; i <= 5; i++) fprintf(f, "line %d\\n", i);
    fclose(f);

    f = fopen("data.txt", "r");
    char buf[64];
    while (fgets(buf, sizeof buf, f)) printf("read: %s", buf);
    fclose(f);
    return 0;
}
`,
  },
  {
    category: "Other", title: "Bit manipulation",
    code: `#include <stdio.h>

static void bits(unsigned v) {
    for (int i = 7; i >= 0; i--) putchar((v >> i) & 1 ? '1' : '0');
}

int main(void) {
    unsigned x = 0b10110010;
    printf("x       = "); bits(x); printf(" (%u)\\n", x);
    printf("x << 1  = "); bits((x << 1) & 0xFF); printf("\\n");
    printf("x >> 2  = "); bits(x >> 2); printf("\\n");
    printf("~x      = "); bits(~x & 0xFF); printf("\\n");
    printf("set bit0= "); bits(x | 1); printf("\\n");
    printf("clr bit1= "); bits(x & ~(1u << 1)); printf("\\n");
    printf("toggle 7= "); bits(x ^ (1u << 7)); printf("\\n");
    printf("is bit 4 set? %s\\n", (x >> 4) & 1 ? "yes" : "no");
    return 0;
}
`,
  },
];

export const CPP_EXAMPLES: Example[] = [
  {
    category: "Basics", title: "Hello, World",
    code: `#include <iostream>

int main() {
    std::cout << "Hello, World!\\n";
    return 0;
}
`,
  },
  {
    category: "Basics", title: "Input and arithmetic", stdin: "Asha 17 5",
    code: `#include <iostream>
#include <string>

int main() {
    std::string name;
    int a, b;
    std::cout << "Enter name and two integers: ";
    std::cin >> name >> a >> b;

    std::cout << "Hello, " << name << "!\\n"
              << a << " + " << b << " = " << a + b << '\\n'
              << a << " / " << b << " = " << static_cast<double>(a) / b << '\\n';
    return 0;
}
`,
  },
  {
    category: "Basics", title: "auto, range-for, structured bindings",
    code: `#include <iostream>
#include <map>
#include <string>
#include <vector>

int main() {
    std::vector<int> nums{3, 1, 4, 1, 5, 9, 2, 6};
    for (auto n : nums) std::cout << n << ' ';
    std::cout << '\\n';

    std::map<std::string, int> ages{{"Asha", 31}, {"Ben", 27}, {"Chen", 45}};
    for (const auto &[name, age] : ages)
        std::cout << name << " is " << age << '\\n';
    return 0;
}
`,
  },
  {
    category: "STL containers", title: "vector and algorithms",
    code: `#include <algorithm>
#include <iostream>
#include <numeric>
#include <vector>

int main() {
    std::vector<int> v{5, 2, 8, 1, 9, 3};

    std::sort(v.begin(), v.end());
    for (int x : v) std::cout << x << ' ';
    std::cout << '\\n';

    std::cout << "sum   = " << std::accumulate(v.begin(), v.end(), 0) << '\\n';
    std::cout << "max   = " << *std::max_element(v.begin(), v.end()) << '\\n';
    std::cout << "has 8 = " << std::binary_search(v.begin(), v.end(), 8) << '\\n';

    v.erase(std::remove_if(v.begin(), v.end(), [](int x) { return x % 2 == 0; }), v.end());
    std::cout << "odds  =";
    for (int x : v) std::cout << ' ' << x;
    std::cout << '\\n';
    return 0;
}
`,
  },
  {
    category: "STL containers", title: "Word frequency (map)", stdin: "the quick brown fox jumps over the lazy dog the end",
    code: `#include <iostream>
#include <map>
#include <string>

int main() {
    std::map<std::string, int> freq;
    std::string w;
    while (std::cin >> w) ++freq[w];

    for (const auto &[word, count] : freq)
        std::cout << word << ": " << count << '\\n';
    return 0;
}
`,
  },
  {
    category: "STL containers", title: "stack, queue, priority_queue, set",
    code: `#include <iostream>
#include <queue>
#include <set>
#include <stack>
#include <vector>

int main() {
    std::stack<int> st;
    for (int i = 1; i <= 3; i++) st.push(i);
    std::cout << "stack pop order:";
    while (!st.empty()) { std::cout << ' ' << st.top(); st.pop(); }

    std::queue<int> q;
    for (int i = 1; i <= 3; i++) q.push(i);
    std::cout << "\\nqueue order:";
    while (!q.empty()) { std::cout << ' ' << q.front(); q.pop(); }

    std::priority_queue<int> pq;
    for (int x : {4, 9, 1, 7}) pq.push(x);
    std::cout << "\\nmax-heap order:";
    while (!pq.empty()) { std::cout << ' ' << pq.top(); pq.pop(); }

    std::set<int> s{5, 3, 5, 1, 3};
    std::cout << "\\nset (unique, sorted):";
    for (int x : s) std::cout << ' ' << x;
    std::cout << '\\n';
    return 0;
}
`,
  },
  {
    category: "Strings", title: "String operations",
    code: `#include <algorithm>
#include <cctype>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

int main() {
    std::string s = "Learning C++ is fun";
    std::cout << "length: " << s.size() << '\\n';
    std::cout << "find 'C++': " << s.find("C++") << '\\n';
    std::cout << "substr: " << s.substr(0, 8) << '\\n';

    std::string up = s;
    std::transform(up.begin(), up.end(), up.begin(), [](unsigned char c) { return std::toupper(c); });
    std::cout << "upper: " << up << '\\n';

    std::string rev(s.rbegin(), s.rend());
    std::cout << "reversed: " << rev << '\\n';

    std::istringstream in(s);
    std::vector<std::string> words;
    for (std::string w; in >> w;) words.push_back(w);
    std::cout << "words: " << words.size() << '\\n';
    return 0;
}
`,
  },
  {
    category: "Object-oriented", title: "Classes and encapsulation",
    code: `#include <iostream>
#include <string>

class BankAccount {
public:
    BankAccount(std::string owner, double balance) : owner_(std::move(owner)), balance_(balance) {}

    bool withdraw(double amount) {
        if (amount > balance_) return false;
        balance_ -= amount;
        return true;
    }
    void deposit(double amount) { balance_ += amount; }
    double balance() const { return balance_; }
    const std::string &owner() const { return owner_; }

private:
    std::string owner_;
    double balance_;
};

int main() {
    BankAccount acct("Asha", 100.0);
    acct.deposit(50);
    std::cout << acct.owner() << " has " << acct.balance() << '\\n';
    std::cout << "withdraw 500: " << (acct.withdraw(500) ? "ok" : "denied") << '\\n';
    std::cout << "withdraw 30:  " << (acct.withdraw(30) ? "ok" : "denied") << '\\n';
    std::cout << "balance now " << acct.balance() << '\\n';
    return 0;
}
`,
  },
  {
    category: "Object-oriented", title: "Inheritance and virtual functions",
    code: `#include <iostream>
#include <memory>
#include <vector>

struct Shape {
    virtual ~Shape() = default;
    virtual double area() const = 0;
    virtual const char *name() const = 0;
};

struct Circle : Shape {
    double r;
    explicit Circle(double r) : r(r) {}
    double area() const override { return 3.14159265 * r * r; }
    const char *name() const override { return "circle"; }
};

struct Rect : Shape {
    double w, h;
    Rect(double w, double h) : w(w), h(h) {}
    double area() const override { return w * h; }
    const char *name() const override { return "rectangle"; }
};

int main() {
    std::vector<std::unique_ptr<Shape>> shapes;
    shapes.push_back(std::make_unique<Circle>(2.0));
    shapes.push_back(std::make_unique<Rect>(3.0, 4.5));

    for (const auto &s : shapes)            // dynamic dispatch
        std::cout << s->name() << " area = " << s->area() << '\\n';
    return 0;
}
`,
  },
  {
    category: "Object-oriented", title: "Operator overloading",
    code: `#include <iostream>

struct Vec2 {
    double x, y;
    Vec2 operator+(const Vec2 &o) const { return {x + o.x, y + o.y}; }
    Vec2 operator*(double k) const { return {x * k, y * k}; }
    bool operator==(const Vec2 &o) const { return x == o.x && y == o.y; }
};

std::ostream &operator<<(std::ostream &os, const Vec2 &v) {
    return os << '(' << v.x << ", " << v.y << ')';
}

int main() {
    Vec2 a{1, 2}, b{3, 4};
    std::cout << a << " + " << b << " = " << a + b << '\\n';
    std::cout << a << " * 3 = " << a * 3 << '\\n';
    std::cout << "equal? " << std::boolalpha << (a == b) << '\\n';
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "Templates",
    code: `#include <iostream>
#include <string>
#include <vector>

template <typename T>
T max_of(const T &a, const T &b) { return a > b ? a : b; }

template <typename T>
class Stack {
public:
    void push(T v) { items_.push_back(std::move(v)); }
    T pop() { T v = std::move(items_.back()); items_.pop_back(); return v; }
    bool empty() const { return items_.empty(); }
private:
    std::vector<T> items_;
};

int main() {
    std::cout << max_of(3, 7) << ' ' << max_of(2.5, 1.5) << ' ' << max_of<std::string>("apple", "pear") << '\\n';

    Stack<std::string> s;
    s.push("a"); s.push("b"); s.push("c");
    while (!s.empty()) std::cout << s.pop() << ' ';
    std::cout << '\\n';
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "Lambdas and std::function",
    code: `#include <algorithm>
#include <functional>
#include <iostream>
#include <vector>

int main() {
    int factor = 3;
    auto times = [factor](int x) { return x * factor; };          // capture by value
    std::cout << "times(7) = " << times(7) << '\\n';

    std::vector<int> v{5, 2, 9, 1, 7};
    std::sort(v.begin(), v.end(), [](int a, int b) { return a > b; });
    for (int x : v) std::cout << x << ' ';
    std::cout << '\\n';

    std::function<int(int)> fact = [&](int n) { return n <= 1 ? 1 : n * fact(n - 1); };
    std::cout << "5! = " << fact(5) << '\\n';

    int count = 0;
    std::for_each(v.begin(), v.end(), [&count](int x) { if (x > 4) ++count; });  // capture by ref
    std::cout << count << " values greater than 4\\n";
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "Smart pointers (RAII)",
    code: `#include <iostream>
#include <memory>

struct Resource {
    explicit Resource(int id) : id(id) { std::cout << "acquire " << id << '\\n'; }
    ~Resource() { std::cout << "release " << id << '\\n'; }
    int id;
};

int main() {
    {
        auto u = std::make_unique<Resource>(1);          // sole owner
        std::cout << "unique owns " << u->id << '\\n';
    }                                                    // released here

    auto s1 = std::make_shared<Resource>(2);
    {
        auto s2 = s1;                                    // shared owner
        std::cout << "use_count = " << s1.use_count() << '\\n';
    }
    std::cout << "use_count = " << s1.use_count() << '\\n';
    std::cout << "end of main\\n";
    return 0;                                            // s1 released here
}
`,
  },
  {
    category: "Modern C++", title: "Exceptions",
    code: `#include <iostream>
#include <stdexcept>
#include <string>

double divide(double a, double b) {
    if (b == 0) throw std::invalid_argument("division by zero");
    return a / b;
}

int main() {
    try {
        std::cout << divide(10, 4) << '\\n';
        std::cout << divide(1, 0) << '\\n';
    } catch (const std::exception &e) {
        std::cout << "caught: " << e.what() << '\\n';
    }

    try {
        std::string s = "abc";
        std::cout << s.at(10) << '\\n';
    } catch (const std::out_of_range &e) {
        std::cout << "caught out_of_range\\n";
    }
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "Sorting structs with a comparator",
    code: `#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

struct Employee {
    std::string name;
    int age;
    double salary;
};

int main() {
    std::vector<Employee> staff{{"Asha", 31, 85000}, {"Ben", 27, 62000}, {"Chen", 45, 120000}, {"Dana", 38, 62000}};

    std::sort(staff.begin(), staff.end(), [](const Employee &a, const Employee &b) {
        if (a.salary != b.salary) return a.salary > b.salary;   // salary desc
        return a.name < b.name;                                 // then name asc
    });

    for (const auto &e : staff)
        std::cout << e.name << "\\t" << e.age << "\\t" << e.salary << '\\n';
    return 0;
}
`,
  },
];

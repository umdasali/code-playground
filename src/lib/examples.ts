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
    code: `#include <cstdio>

int main() {
    std::printf("Hello, World!\\n");
    return 0;
}
`,
  },
  {
    category: "Basics", title: "Input and arithmetic", stdin: "17 5",
    code: `#include <cstdio>

int main() {
    int a, b;
    std::printf("Enter two integers: ");
    if (std::scanf("%d %d", &a, &b) != 2) return 1;

    std::printf("%d + %d = %d\\n", a, b, a + b);
    std::printf("%d / %d = %d (integer)\\n", a, b, a / b);
    std::printf("%d / %d = %.3f (real)\\n", a, b, static_cast<double>(a) / b);
    return 0;
}
`,
  },
  {
    category: "Basics", title: "References, auto, constexpr, enum class",
    code: `#include <cstdio>
#include <initializer_list>

namespace geometry {
    constexpr double pi = 3.14159265358979;
    constexpr double circle_area(double r) { return pi * r * r; }
}

enum class Color { Red, Green, Blue };

const char *name_of(Color c) {
    switch (c) {
        case Color::Red:   return "red";
        case Color::Green: return "green";
        case Color::Blue:  return "blue";
    }
    return "?";
}

void add_one(int &x) { x += 1; }          // reference parameter: modifies the caller's variable

int main() {
    int n = 41;
    add_one(n);
    auto area = geometry::circle_area(2.0);   // computed at compile time
    std::printf("n = %d, area = %.3f\\n", n, area);
    for (Color c : {Color::Red, Color::Green, Color::Blue})
        std::printf("%s ", name_of(c));
    std::printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Object-oriented", title: "Classes and encapsulation",
    code: `#include <cstdio>

class BankAccount {
public:
    BankAccount(const char *owner, double balance) : owner_(owner), balance_(balance) {}

    bool withdraw(double amount) {
        if (amount > balance_) return false;
        balance_ -= amount;
        return true;
    }
    void deposit(double amount) { balance_ += amount; }
    double balance() const { return balance_; }
    const char *owner() const { return owner_; }

private:
    const char *owner_;
    double balance_;
};

int main() {
    BankAccount acct("Asha", 100.0);
    acct.deposit(50);
    std::printf("%s has %.2f\\n", acct.owner(), acct.balance());
    std::printf("withdraw 500: %s\\n", acct.withdraw(500) ? "ok" : "denied");
    std::printf("withdraw 30:  %s\\n", acct.withdraw(30) ? "ok" : "denied");
    std::printf("balance now %.2f\\n", acct.balance());
    return 0;
}
`,
  },
  {
    category: "Object-oriented", title: "Inheritance and virtual functions",
    code: `#include <cstdio>

struct Shape {
    virtual ~Shape() {}
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
    Shape *shapes[] = { new Circle(2.0), new Rect(3.0, 4.5) };
    for (Shape *s : shapes)                       // dynamic dispatch through the base class
        std::printf("%s area = %.2f\\n", s->name(), s->area());
    for (Shape *s : shapes) delete s;
    return 0;
}
`,
  },
  {
    category: "Object-oriented", title: "Operator overloading",
    code: `#include <cstdio>

struct Vec2 {
    double x, y;
    Vec2 operator+(const Vec2 &o) const { return {x + o.x, y + o.y}; }
    Vec2 operator-(const Vec2 &o) const { return {x - o.x, y - o.y}; }
    Vec2 operator*(double k) const { return {x * k, y * k}; }
    bool operator==(const Vec2 &o) const { return x == o.x && y == o.y; }
};

void show(const char *label, const Vec2 &v) { std::printf("%s = (%.1f, %.1f)\\n", label, v.x, v.y); }

int main() {
    Vec2 a{1, 2}, b{3, 4};
    show("a + b", a + b);
    show("b - a", b - a);
    show("a * 3", a * 3);
    std::printf("a == b? %s\\n", a == b ? "yes" : "no");
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "Templates",
    code: `#include <cstdio>

template <typename T>
T max_of(const T &a, const T &b) { return a > b ? a : b; }

template <typename T, int N>
class Stack {
public:
    bool push(T v) { if (size_ == N) return false; items_[size_++] = v; return true; }
    bool pop(T &out) { if (size_ == 0) return false; out = items_[--size_]; return true; }
    int size() const { return size_; }
private:
    T items_[N];
    int size_ = 0;
};

int main() {
    std::printf("%d %.1f %c\\n", max_of(3, 7), max_of(2.5, 1.5), max_of('a', 'z'));

    Stack<int, 4> s;
    for (int i = 1; i <= 5; i++)
        if (!s.push(i * 10)) std::printf("stack full, dropped %d\\n", i * 10);
    int v;
    while (s.pop(v)) std::printf("%d ", v);
    std::printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "Lambdas",
    code: `#include <cstdio>
#include <cstdlib>

template <typename F>
void repeat(int times, F body) { for (int i = 0; i < times; i++) body(i); }

int main() {
    int factor = 3;
    auto times = [factor](int x) { return x * factor; };      // capture by value
    std::printf("times(7) = %d\\n", times(7));

    int total = 0;
    repeat(5, [&total](int i) { total += i; });                // capture by reference
    std::printf("sum 0..4 = %d\\n", total);

    int a[] = {5, 2, 9, 1, 7};
    std::qsort(a, 5, sizeof a[0], [](const void *x, const void *y) {   // captureless lambda -> function pointer
        return *static_cast<const int *>(y) - *static_cast<const int *>(x);
    });
    for (int v : a) std::printf("%d ", v);
    std::printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "RAII ownership (a unique_ptr you write)",
    code: `#include <cstdio>

struct Resource {
    explicit Resource(int id) : id(id) { std::printf("acquire %d\\n", id); }
    ~Resource() { std::printf("release %d\\n", id); }
    int id;
};

// Owns one heap object and frees it automatically; copying is forbidden, moving transfers ownership.
template <typename T>
class Owner {
public:
    explicit Owner(T *p = nullptr) : p_(p) {}
    ~Owner() { delete p_; }
    Owner(const Owner &) = delete;
    Owner &operator=(const Owner &) = delete;
    Owner(Owner &&o) noexcept : p_(o.p_) { o.p_ = nullptr; }
    T *operator->() const { return p_; }
    explicit operator bool() const { return p_ != nullptr; }
private:
    T *p_;
};

int main() {
    {
        Owner<Resource> a(new Resource(1));
        std::printf("a owns %d\\n", a->id);
        Owner<Resource> b(static_cast<Owner<Resource> &&>(a));   // ownership moves to b
        std::printf("a still owns something? %s\\n", a ? "yes" : "no");
        std::printf("b owns %d\\n", b->id);
    }                                                          // b's destructor releases the resource
    std::printf("end of main\\n");
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "array and optional",
    code: `#include <array>
#include <cstdio>
#include <initializer_list>
#include <optional>

struct MinMax { int lo, hi; };

MinMax min_max(const std::array<int, 5> &a) {
    int lo = a[0], hi = a[0];
    for (int v : a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return {lo, hi};
}

std::optional<int> find_index(const std::array<int, 5> &a, int target) {
    for (int i = 0; i < 5; i++)
        if (a[i] == target) return i;
    return std::nullopt;
}

int main() {
    std::array<int, 5> nums{42, 7, 19, 88, 3};
    auto [lo, hi] = min_max(nums);                       // structured bindings
    std::printf("min=%d max=%d size=%zu\\n", lo, hi, nums.size());

    for (int target : {19, 100}) {
        if (auto idx = find_index(nums, target))
            std::printf("%d found at %d\\n", target, *idx);
        else
            std::printf("%d not found\\n", target);
    }
    return 0;
}
`,
  },
  {
    category: "Memory", title: "RAII dynamic array",
    code: `#include <cstdio>
#include <cstring>

class IntArray {
public:
    IntArray() : data_(new int[2]), size_(0), cap_(2) {}
    ~IntArray() { delete[] data_; }
    IntArray(const IntArray &) = delete;                 // no accidental copies
    IntArray &operator=(const IntArray &) = delete;

    void push(int v) {
        if (size_ == cap_) {                              // grow when full
            int *bigger = new int[cap_ * 2];
            std::memcpy(bigger, data_, size_ * sizeof(int));
            delete[] data_;
            data_ = bigger;
            cap_ *= 2;
            std::printf("grew to capacity %d\\n", cap_);
        }
        data_[size_++] = v;
    }
    int size() const { return size_; }
    int operator[](int i) const { return data_[i]; }

private:
    int *data_;
    int size_, cap_;
};

int main() {
    IntArray a;
    for (int i = 1; i <= 10; i++) a.push(i * i);
    for (int i = 0; i < a.size(); i++) std::printf("%d ", a[i]);
    std::printf("\\n");
    return 0;                                             // destructor frees the memory
}
`,
  },
  {
    category: "Functions", title: "Recursion and constexpr",
    code: `#include <cstdio>

constexpr unsigned long long factorial(int n) { return n <= 1 ? 1 : n * factorial(n - 1); }
int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

int main() {
    static_assert(factorial(5) == 120, "evaluated by the compiler");
    for (int i = 0; i <= 10; i++)
        std::printf("%2d! = %llu\\n", i, factorial(i));
    std::printf("fib:");
    for (int i = 0; i < 15; i++) std::printf(" %d", fib(i));
    std::printf("\\n");
    return 0;
}
`,
  },
  {
    category: "Input and output", title: "Streams: cin and cout", stdin: "Asha 31 1.68",
    code: `#include <iomanip>
#include <iostream>
#include <string>

int main() {
    std::string name;
    int age;
    double height;
    std::cout << "Name, age and height? ";
    std::cin >> name >> age >> height;

    std::cout << "Hello, " << name << "!" << std::endl;
    std::cout << "In 10 years you will be " << age + 10 << ".\\n";
    std::cout << std::fixed << std::setprecision(1) << "Height: " << height << " m\\n";
    std::cout << std::setw(8) << "item" << std::setw(8) << "qty" << "\\n";
    std::cout << std::setw(8) << "pens" << std::setw(8) << 12 << "\\n";
    return 0;
}
`,
  },
  {
    category: "Containers", title: "vector and algorithms",
    code: `#include <algorithm>
#include <iostream>
#include <numeric>
#include <string>
#include <vector>

int main() {
    std::vector<int> nums = {42, 7, 19, 3, 88, 25};
    nums.push_back(61);

    std::sort(nums.begin(), nums.end());
    std::cout << "sorted:";
    for (int n : nums) std::cout << ' ' << n;
    std::cout << "\\n";

    std::cout << "sum = " << std::accumulate(nums.begin(), nums.end(), 0) << "\\n";
    std::cout << "max = " << *std::max_element(nums.begin(), nums.end()) << "\\n";
    std::cout << "evens = " << std::count_if(nums.begin(), nums.end(), [](int n) { return n % 2 == 0; }) << "\\n";

    std::vector<std::string> words = {"pear", "apple", "fig", "banana"};
    std::sort(words.begin(), words.end(), [](const std::string &a, const std::string &b) { return a.size() < b.size(); });
    for (const std::string &w : words) std::cout << w << " (" << w.size() << ")\\n";
    return 0;
}
`,
  },
  {
    category: "Modern C++", title: "unique_ptr and shared_ptr",
    code: `#include <iostream>
#include <memory>
#include <vector>

struct Shape {
    virtual ~Shape() { std::cout << "  ~Shape\\n"; }
    virtual double area() const = 0;
};
struct Square : Shape {
    explicit Square(double s) : side(s) {}
    double area() const override { return side * side; }
    double side;
};
struct Circle : Shape {
    explicit Circle(double r) : radius(r) {}
    double area() const override { return 3.14159 * radius * radius; }
    double radius;
};

int main() {
    std::vector<std::unique_ptr<Shape>> shapes;
    shapes.push_back(std::make_unique<Square>(3));
    shapes.push_back(std::make_unique<Circle>(2));
    for (const auto &s : shapes) std::cout << "area " << s->area() << "\\n";

    auto shared = std::make_shared<Square>(5);
    std::cout << "owners: " << shared.use_count() << "\\n";
    {
        std::shared_ptr<Square> other = shared;
        std::cout << "owners: " << shared.use_count() << "\\n";
    }
    std::cout << "owners: " << shared.use_count() << "\\n";
    std::cout << "end of main, everything is freed automatically\\n";
    return 0;
}
`,
  },
  {
    category: "Strings", title: "std::string", stdin: "level",
    code: `#include <algorithm>
#include <cctype>
#include <iostream>
#include <string>

bool is_palindrome(const std::string &s) {
    std::string r = s;
    std::reverse(r.begin(), r.end());
    return r == s;
}

int main() {
    std::string line;
    std::getline(std::cin, line);

    std::string upper = line;
    for (char &c : upper) c = static_cast<char>(toupper(static_cast<unsigned char>(c)));

    std::cout << "you typed:  " << line << "\\n";
    std::cout << "uppercase:  " << upper << "\\n";
    std::cout << "length:     " << line.size() << "\\n";
    std::cout << "palindrome: " << (is_palindrome(line) ? "yes" : "no") << "\\n";

    std::string greeting = "Hello, " + line + "!";
    std::cout << greeting << " (first space at " << greeting.find(' ') << ")\\n";
    return 0;
}
`,
  },
];

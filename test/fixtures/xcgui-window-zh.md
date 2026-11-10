# package window

Package window 里封装了 Window, ModalWindow, FrameWindow, FloatWindow, TrayIcon.

## Types

```go
type FloatWindow struct {
	// contains filtered or unexported fields
}
```
FloatWindow 浮动窗口.

```go
func NewFloatWindowByName(name string) *FloatWindow
```
从name创建对象, 失败返回 nil.

```go
func (w *FloatWindow) AddEvent_Menu_DrawItem(fn func(hWindow int, hDraw int, pInfo *xc.Menu_DrawItem_, pbHandled *bool) int, allowAddingMultiple ...bool) int
```
绘制菜单项事件.

```go
func (w *FloatWindow) EnableAutoWrap(bEnable ...bool) *windowBase
```
EnableAutoWrap 布局盒子\_启用自动换行.

bEnable: 是否启用, 不填默认为 true.

```go
func New(x, y, cx, cy int32, title string, hWndParent uintptr, XCStyle xcc.Window_Style_) *Window
```
New 窗口\_创建, 失败返回 nil.

x: 窗口左上角x坐标.

y: 窗口左上角y坐标.

cx: 窗口宽度.

cy: 窗口高度.

title: 窗口标题.

hWndParent: 父窗口(真实窗口句柄).

XCStyle: 窗口样式: xcc.Window\_Style\_.

```go
func NewByHandle(hWindow int) *Window
```
NewByHandle 从句柄创建窗口对象, 失败返回 nil.

hWindow: 窗口资源句柄.

```go
func NewByLayout(fileName string, hParent int, hAttachWnd ...uintptr) *Window
```
NewByLayout 从布局文件创建窗口对象, 失败返回 nil.

fileName: 布局文件名.

hParent: 父对象句柄.

hAttachWnd: 附加窗口句柄, 附加到指定的窗口, 不填默认为0.

```go
func NewEx(dwExStyle xcc.WS_EX_, dwStyle xcc.WS_, className string, x, y, cx, cy int32, title string, hWndParent uintptr, XCStyle xcc.Window_Style_) *Window
```
NewEx 窗口\_创建扩展, 失败返回 nil.

dwExStyle: 窗口扩展样式. xcc.WS\_EX\_ .

dwStyle: 窗口样式. xcc.WS\_ .

className: 窗口类名.

x: 窗口左上角x坐标.

y: 窗口左上角y坐标.

cx: 窗口宽度.

cy: 窗口高度.

title: 窗口名.

hWndParent: 父窗口(真实窗口句柄).

XCStyle: 窗口样式, xcc.Window\_Style\_.

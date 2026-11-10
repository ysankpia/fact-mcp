# package mygo

Package mygo is a desktop application framework written in pure Go, without cgo. Each window shows a web page, in the system webview (WKWebView on macOS, WebKitGTK on Linux, WebView2 on Windows), or native UI that MyGo draws itself, written in Go with package [github.com/egoist/mygo/ui](/github.com/egoist/mygo/ui); one app can have windows of both kinds.

A window with a web page shows the app's frontend, which calls the Go services the app binds through a TypeScript client that \`mygo generate\` writes. The app opens its windows once it is ready:

	type Greeter struct{}

	// Greet returns a greeting.
	func (Greeter) Greet(name string) string { return "Hello, " + name }

	func main() {
		mygo.Bind(Greeter{})
		mygo.App.WhenReady(func() {
			mygo.NewWindow(mygo.WindowOptions{Title: "Hello", URL: "/"})
		})
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
	}

The frontend then calls \`await Greeter.greet("Ada")\`. Go reaches pages with typed events declared with NewEvent.

A window of native UI takes a view, a function of the app's state that builds its interface each frame, in place of a URL, and needs no bindings:

	mygo.NewWindow(mygo.WindowOptions{Title: "Counter", Content: ui.View(app.view)})

The rest of the package covers the desktop, for windows of both kinds: App (the lifecycle, deep links, file associations, the Dock), Window and its Page, NewMenu and NewTray, Dialog, NewNotification, Clipboard, Shell, Screen, Theme, Power, GlobalShortcut, Protocol (custom URL schemes served by an http.Handler) and Updater. The guides in the repository's docs directory show how they fit together.

### Threading {#hdr-Threading}

The system's UI toolkits (AppKit, GTK, Win32) must be driven from the process' main thread. MyGo locks the main goroutine to the main thread during package initialization, so App.Run must be called from main(). Every other function and method in this package is safe to call from any goroutine: calls made off the main thread are forwarded to it and wait for the result.

Before App.Run, main sets the app up: it binds services, adds listeners and makes settings, such as Theme.SetSource, which apply once the app starts. Calls that need the running app, such as the clipboard, displays or dialogs, panic when main makes them before Run; other goroutines wait for the app to start.

Event listeners (OnClose, OnFocus, ...) run on the main thread; keep them short and move slow work to a goroutine. Methods of bound services run on goroutines of their own, one per call, so they may block.

## Constants

```go
const (
	ContextMenuBack                 = "back"
	ContextMenuForward              = "forward"
	ContextMenuReload               = "reload"
	ContextMenuStop                 = "stop"
	ContextMenuInspect              = "inspect" // Inspect Element, with DevTools
	ContextMenuUndo                 = "undo"
	ContextMenuRedo                 = "redo"
	ContextMenuCut                  = "cut"
	ContextMenuCopy                 = "copy"
	ContextMenuPaste                = "paste"
	ContextMenuPasteAndMatchStyle   = "pasteAndMatchStyle"
	ContextMenuDelete               = "delete"
	ContextMenuSelectAll            = "selectAll"
	ContextMenuSpellingGuess        = "spellingGuess" // each of the words suggested for a misspelled one
	ContextMenuOpenLink             = "openLink"
	ContextMenuOpenLinkInNewWindow  = "openLinkInNewWindow"
	ContextMenuDownloadLink         = "downloadLink"
	ContextMenuCopyLink             = "copyLink"
	ContextMenuOpenImageInNewWindow = "openImageInNewWindow"
	ContextMenuDownloadImage        = "downloadImage"
	ContextMenuCopyImage            = "copyImage"
	ContextMenuCopyImageURL         = "copyImageURL"
	ContextMenuOpenFrameInNewWindow = "openFrameInNewWindow"
	ContextMenuOpenMediaInNewWindow = "openMediaInNewWindow"
	ContextMenuDownloadMedia        = "downloadMedia"
	ContextMenuCopyMediaURL         = "copyMediaURL"
	ContextMenuMediaControls        = "mediaControls" // show or hide a video's controls
	ContextMenuMediaLoop            = "mediaLoop"
	ContextMenuMediaFullScreen      = "mediaFullScreen"
	ContextMenuPictureInPicture     = "pictureInPicture"
	ContextMenuLookUp               = "lookUp"
	ContextMenuSearchWeb            = "searchWeb"
	ContextMenuShare                = "share"
	ContextMenuEmoji                = "emoji"
	ContextMenuPrint                = "print"
)
```

The IDs of the web view's own items in a page's context menu (ContextMenuEvent.Menu), the same on every platform that has the item. Items without one of these keep the platform's own name as their ID: WebKit's identifier on macOS ("WKMenuItemIdentifierTranslateMenu"), the nick of the stock action on Linux ("spelling-guess"), WebView2's name on Windows ("createQrCode"); items the platform names none of have "".

## Variables

```go
var (
	PageLetter  = PageSize{8.5, 11}
	PageLegal   = PageSize{8.5, 14}
	PageTabloid = PageSize{11, 17}
	PageA3      = PageSize{11.69, 16.54}
	PageA4      = PageSize{8.27, 11.69}
	PageA5      = PageSize{5.83, 8.27}
)
```

Paper sizes.

```go
var App = &Application{readyCh: make(chan struct{}), Dock: &Dock{}, JumpList: &JumpList{}}
```

App is the application singleton.

## Functions

```go
func Bind(services ...any)
```

Bind exposes the exported methods of each service to the frontend. The generated TypeScript client (see \`mygo generate\`) turns

	type Greeter struct{}

	// Greet returns a greeting.
	func (Greeter) Greet(name string) (string, error)

into a typed \`Greeter.greet(name: string): Promise\<string>\` function.

Arguments and results are encoded as JSON. A method may take a context.Context as its first parameter: it is canceled when the calling page navigates away or its window closes, and CallerWindow returns the calling window from it. A method may return nothing, a value, an error, or a value and an error; a non-nil error rejects the promise on the JavaScript side. Calls run on their own goroutine.

The service is named after its type; Bind panics if the name is taken or a method uses a type that cannot be encoded as JSON (channels, functions).

```go
func BindAs(name string, service any)
```

BindAs is Bind with an explicit service name, for services whose type names collide.

## Types

```go
type Application struct {

	// Dock controls the Dock icon on macOS.
	Dock *Dock
	// JumpList controls the jump list of the taskbar button on Windows.
	JumpList *JumpList
	// contains filtered or unexported fields
}
```

Application controls the event loop and the lifecycle of the process. Use the App singleton.

```go
func (a *Application) Name() string
```

Name returns the application name. It defaults to the bundle name of a packaged app, else to the executable name.

```go
func (a *Application) Show()
```

Show shows the application after Hide (macOS).

```go
type Channel[T any] struct {
	// contains filtered or unexported fields
}
```

Channel streams values of type T from a bound method to the page that called it, like a response that arrives in parts: the lines a command prints, the tokens of a model's answer, the progress of a download.

```go
func (ch *Channel[T]) Close()
```

Close closes the channel, which ends the page's iteration once it took the values sent before. It is called when the method returns.

```go
func (ch *Channel[T]) Send(v T) error
```

Send sends v to the page. It fails once the channel is closed.

```go
type CookiesModule struct {
	// contains filtered or unexported fields
}
```

CookiesModule reads and writes the cookies of a session.

```go
func (m CookiesModule) Set(c Cookie) error
```

Set adds the cookie, or replaces the one of the same name, domain and path.

```go
type Dock struct {
	// contains filtered or unexported fields
}
```

Dock controls the application's Dock icon (macOS). Its methods do nothing on other platforms.

```go
func (d *Dock) Show()
```

Show restores the Dock icon (regular activation policy).

```go
type Document[T any] struct {
	// contains filtered or unexported fields
}
```

Document is an open document: its content, the file it was read from and is saved to, and its window. Its methods are safe from any goroutine.

```go
func (d *Document[T]) Window() *Window
```

Window returns the window that shows the document.

```go
func (b *Document) Close()
```

Close closes the document's window, which asks to save the document first when it must.

```go
func (b *Document) Name() string
```

Name returns the document's file name, or the name of an untitled document, such as "Untitled 2".

```go
func (d *Document[T]) Set(content T)
```

Set replaces the document's content, which edits it, unless DocumentsOptions.Equal finds it equal to what its file has.

```go
type Event[T any] struct {
	// contains filtered or unexported fields
}
```

Event is a typed event the Go side sends to pages. Declare events at package level so `mygo generate` includes them in the TypeScript client:

	var Progress = mygo.NewEvent[ProgressInfo]("progress")

	Progress.Emit(win, ProgressInfo{Done: 1, Total: 3})

and subscribe in the frontend with `events.progress.on(p => ...)`.

```go
func (e *Event[T]) Name() string
```

Name returns the event name.

```go
type NowPlayingModule struct {
	// contains filtered or unexported fields
}
```

NowPlayingModule shows what the app plays where the system shows media.

```go
func (n *NowPlayingModule) Set(info NowPlayingInfo)
```

Set shows info where the system shows media, replacing what it showed. It may be called before App.Run, and the system shows it once the app is ready.

```go
type Page struct {
	// contains filtered or unexported fields
}
```

Page is the web page a window shows: what it loads, the scripts it runs, its developer tools and its events. A window showing native UI (WindowOptions.Content) has none.

	win := mygo.NewWindow(mygo.WindowOptions{Title: "Editor", URL: "/"})
	win.Page().OnDOMReady(func() { log.Println("ready") })

Like the window's, its methods are safe from any goroutine.

```go
func (p *Page) Window() *Window
```

Window returns the window that shows the page: for the page of a web view, the window the web view is in.

```go
type SecretsModule struct {
	// contains filtered or unexported fields
}
```

SecretsModule keeps small secrets, such as access tokens and API keys, in the system's credential store.

```go
func (s SecretsModule) Set(key string, value []byte) error
```

Set stores value under key, replacing what it had. The key must not be empty or longer than 256 bytes; the value may be at most MaxSecretSize bytes.

```go
type Tray struct {
	// contains filtered or unexported fields
}
```

Tray is an icon in the menu bar (macOS) or notification area.

```go
func (t *Tray) SetMenu(m *Menu)
```

SetMenu sets the menu shown when the icon is clicked; nil removes it so clicks reach OnClick.

```go
type WebView struct {
	// contains filtered or unexported fields
}
```

WebView is a web page inside a window's native UI, which the window's view places with ui.WebView: a document the web engine renders beside native controls, a page per tab, a preview of HTML the app makes.

	docs, err := win.NewWebView(mygo.WebViewOptions{URL: "/docs"})

	// In the view:
	ui.Row(c).Fill().Children(func() {
		sidebar(c)
		ui.WebView(c, docs).Grow(1)
	})

Its page works as a window's does: it loads the app's frontend, calls bound Go methods (CallerPage tells which page called, CallerWindow the window it is in), hears events (Event.EmitPage, Broadcast) and evaluates scripts. The web view shows where the view places it, under what the view paints after it, as popovers and menus, while the view builds it; it keeps its page while it does not show, until Destroy or until its window closes. Its methods are safe from any goroutine.

```go
func (v *WebView) Window() *Window
```

Window returns the window the web view is in.

```go
type Window struct {
	// contains filtered or unexported fields
}
```

Window is a native window hosting a web page, or the Content of package ui. Create windows with NewWindow once the application is ready.

```go
func CallerWindow(ctx context.Context) *Window
```

CallerWindow returns the window whose page called a bound method, given the context.Context passed to that method, or whose page made a request to a custom scheme (Protocol), given the request's Context: for the page of a web view (WebView), the window it is in. It returns nil for other contexts.

```go
func NewWindow(opts WindowOptions) *Window
```

NewWindow creates a window. It must be called after the application is ready (see Application.WhenReady); when called from another goroutine it waits for that.

```go
func (w *Window) Close()
```

Close closes the window as if the user clicked its close button, so OnClose listeners can cancel it.

```go
func (w *Window) Hide()
```

Hide hides the window. Called right after NewWindow, it keeps a window of native UI from showing at all.

```go
func (w *Window) ID() int
```

ID returns the unique id of the window. The page sees it as window.mygo.windowId.

```go
func (w *Window) Show()
```

Show shows and focuses the window.

```go
func (w *Window) Title() string
```

Title returns the window title, without the mark of an edited document (see SetDocumentEdited).

```go
type WindowButtons struct {
	Start, End []string
}
```

WindowButtons are the window controls the desktop puts in title bars, at their start and at their end: "minimize", "maximize" and "close", in the desktop's order. An app that hides the system's (HideWindowButtons) and draws its own can draw these, where the desktop wants them.

```go
func (b WindowButtons) Empty() bool
```

Empty reports that the desktop puts no buttons in title bars.

```go
type WindowOptions struct {
	// Title of the window. Defaults to the application name. The title
	// follows the page's <title> unless an OnPageTitleUpdated listener
	// prevents it.
	Title string
	// URL is loaded right after the window is created. "/" and other URLs
	// without a scheme are pages of the app's frontend (see LoadURL).
	// Page.SessionState, when set, takes its place.
	URL string

	// Width and Height of the window in DIPs (default 800x600).
	Width, Height int
	// UseContentSize makes Width and Height describe the page area instead
	// of the whole window.
	UseContentSize bool
	// X and Y of the top-left corner. The window is centered when both are
	// zero.
	X, Y                int
	MinWidth, MinHeight int
	MaxWidth, MaxHeight int
	// FitContent sizes the page area to its page's content, and follows
	// it as it changes, as FlyoutOptions.FitContent sizes a flyout: a
	// panel showing a launcher's results, say. Width and Height are its
	// size until the page tells its own. MinWidth, MinHeight, MaxWidth
	// and MaxHeight bound it, and the work area of its display. It changes
	// only when the content's size does, and only in the dimension that
	// changed, so a size the user gives a resizable window holds until
	// then, and not while the window is maximized or in full screen.
	// Native UI (Content) does not fit.
	FitContent bool

	// Hidden creates the window without showing it. Call Show, typically
	// from OnReadyToShow, to avoid a blank window while the page loads.
	Hidden bool
	// Frameless removes the title bar and window chrome. Mark draggable
	// areas with the CSS `--app-region: drag`.
	Frameless bool
	// TitleBarStyle hides the title bar but keeps the window controls, so
	// the page fills the window and draws its own title bar under them:
	// the traffic lights on macOS, and minimize, maximize and close at the
	// top corner on Linux and Windows. On Linux they are GTK's own title
	// buttons, and the desktop's button layout decides which show and on
	// which side, possibly none. Pages keep clear of them with the
	// --mygo-titlebar-* CSS variables and drag the window by their title
	// bar with --app-region: drag, as in a frameless window; native UI
	// with ui.Context.TitleBar and ui.Element.DragWindow.
	TitleBarStyle TitleBarStyle
	// TrafficLightPosition moves the window controls of a window with a
	// hidden title bar (macOS): the top-left corner of the close button
	// goes this far from the top-left corner of the window.
	TrafficLightPosition *Point
	// TitleBarHeight is the height of the title bar that the page of a
	// window with a hidden title bar draws (Linux, Windows): the window
	// controls fill it on Windows and are centered in it on Linux. Zero is
	// 32 on Windows, as Windows 11's own title bars, and the height of the
	// desktop's header bars on Linux.
	TitleBarHeight int
	// HideWindowButtons hides the window controls of a window with a hidden
	// title bar (TitleBarStyle), which keeps the rest of it: the shadow,
	// the rounded corners and the resizing edges, the top one included,
	// which a Frameless window lacks on Windows. The page or the view draws
	// its own controls, anywhere, and calls Minimize, Maximize, Unmaximize
	// and Close; the --mygo-titlebar-* CSS variables and
	// ui.Context.TitleBar are then zero.
	HideWindowButtons bool

	DisableResize     bool
	DisableMove       bool
	DisableMinimize   bool
	DisableMaximize   bool
	DisableClose      bool
	DisableFullScreen bool
	DisableShadow     bool
	AlwaysOnTop       bool
	FullScreen        bool
	// Maximized creates the window maximized.
	Maximized bool
	// SkipTaskbar hides the window from the taskbar (Linux, Windows).
	SkipTaskbar bool
	// AutoHideMenuBar keeps the window's menu bar out of sight until the
	// user presses Alt or F10, and hides it again once they leave it
	// (Linux, Windows). Its keyboard shortcuts work all along.
	AutoHideMenuBar bool
	// Transparent makes the window background transparent, so a page with a
	// transparent background shows the desktop through.
	Transparent bool
	// BackgroundColor fills the window until the page paints, which avoids
	// a flash of another color while it loads. CSS syntax: "#1e1e1e",
	// "#rgba", "rgb(30 30 30)", or "light-dark(#f5f5f7, #1e1e1e)" for a
	// page that follows the light or dark appearance.
	BackgroundColor string
	// Vibrancy puts a translucent, blurred material behind a transparent
	// page, or behind native UI where it draws no background (macOS and
	// Windows 11 22H2), e.g. VibrancySidebar; ui.Context.Vibrancy tells
	// native UI whether it shows. On Windows, only a window created with a
	// material can show one, and it has no menu bar: Alt and F10 open its
	// menus in a popup.
	Vibrancy Vibrancy
	// VibrancyTint tints the material, in the syntax of BackgroundColor:
	// "#80ff0000", "rgba(255, 0, 0, 0.5)", or "light-dark(...)" to follow
	// the appearance. Only macOS 26's Liquid Glass takes a tint; other
	// materials and platforms ignore it.
	VibrancyTint string
	// CornerRadius rounds a frameless window's corners on macOS, in DIPs:
	// its content and material are cut to them, and its shadow follows
	// them, as a launcher's or a floating panel's. The window need not be
	// Transparent: its BackgroundColor fills its content, inside the
	// corners. Windows 11 rounds a
	// frameless window given one with the corners of its own windows,
	// whatever the radius; Linux does not round it.
	CornerRadius int
	// Opacity of the window between 0 and 1 (default 1).
	Opacity float64
	// Parent makes this window a child window that stays on top of it
	// and closes with it. It can go to any display, and stays where it is
	// as its parent moves. On macOS it is ordered above its parent
	// whenever the parent comes in front, stays above a parent that is
	// AlwaysOnTop, goes with it into full screen, and hides while the
	// parent is minimized or hidden. The Parent may be a flyout, a tray's
	// included: without X and Y, the window is centered over it, in the
	// work area of its display, and stays above it.
	Parent *Window
	// Modal makes a child window modal to its Parent, which takes no
	// input until it closes: a sheet of the parent on macOS, unless the
	// parent is a flyout. A flyout stays open while a window is modal to
	// it, wherever the keyboard goes, and closing the flyout closes the
	// window: a confirmation a tray's flyout asks for, wider than it.
	Modal bool

	// Panel makes the window a panel, as the windows of launchers and
	// quick entry (Spotlight, Raycast) are: it floats above the windows of
	// all apps, on whichever Space or virtual desktop the user is on, over
	// full-screen apps too, and stays out of the taskbar, the Dock and the
	// app switcher. It cannot be minimized, maximized or go full screen. On
	// macOS, showing or focusing it gives it the keyboard without
	// activating the app, so the app the user was in stays active and gets
	// the keyboard back when the panel hides.
	Panel bool

	// Page configures the window's web page.
	Page PageOptions

	// StateKey remembers the window's position, size, and maximized and
	// full screen state under this key, in window-state.json in
	// PathUserData or the store of App.SetWindowStateStore, saved when
	// the window closes and when the app quits. A window created with the
	// same key, for example at the next launch, gets them back as long as
	// it would show on a connected display: they override X, Y, Width,
	// Height, UseContentSize, Maximized and FullScreen.
	StateKey string

	// Content makes the window show a user interface MyGo draws itself,
	// on the GPU where it can, instead of a web page: create it with
	// package ui. The window then has no page (Window.Page is nil): URL
	// and Page are ignored.
	//
	// The view first runs once NewWindow returned, so that it can use the
	// window NewWindow returns, kept in a variable:
	//
	//	a.win = mygo.NewWindow(mygo.WindowOptions{Content: ui.View(func(c *ui.Context) {
	//		ui.Text(c, a.win.Title())
	//	})})
	//
	// Called on the main thread, as in App.WhenReady or an event handler,
	// NewWindow leaves showing the window to the main loop's next turn, or
	// to the first method that acts on it, such as IsVisible or Maximize,
	// which finds it shown. Called from another goroutine, NewWindow shows
	// the window and returns while the main thread goes on drawing it:
	// guard the variable there, or set it with Window.Update.
	Content Content
}
```

WindowOptions configures NewWindow. The zero value is a visible, resizable 800x600 window centered on screen.

```go
type WindowStateStore interface {
	// LoadWindowStates returns the saved states. It is called once, when
	// the first window with a StateKey is created. Without states (nil, or
	// an error) windows get their options.
	LoadWindowStates() (map[string]WindowState, error)
	// SaveWindowStates replaces the saved states with states, which the
	// store may keep. It is called when a window with a StateKey closes
	// and when the app quits, if a state changed. After an error the
	// next call saves the states again.
	SaveWindowStates(states map[string]WindowState) error
}
```

WindowStateStore keeps the states of the windows with a WindowOptions.StateKey, by key, for App.SetWindowStateStore. MyGo calls it on the main thread, so it should return quickly. It keeps every field of a state, as JSON does: on Windows, a window whose state lost its pixels (WindowState.PixelX) is centered when the displays have different scales.

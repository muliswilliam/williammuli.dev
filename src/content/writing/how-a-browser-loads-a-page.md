---
title: how a browser loads a page
description: What happens between typing a URL and the page showing up on screen.
date: 2019-08-01
heroImage: /writing/browser-hero.jpg
tags: [browsers, rendering, networking]
---

When a user enters a URL(Uniform Resource Locator)/web address in a browser's address bar and presses enter, the browser takes on the responsibility of presenting the web resource to the user by requesting it from the server and displaying the response to the user on the browser window. The response can be HTML, image, PDF or multimedia content such as video or audio.

For us to understand what happens in the browser we need to understand the structure of the browser and how the components of the browser work together to achieve the common goal of displaying content to the user.

### Browser Main Components

**1. Browser User Interface**

This is user facing part of the browser. It includes the address bar, navigation buttons, refresh button, menus such as bookmarks, history etc and browser window where content is finally displayed.

**2. Browser Engine**

The engine acts as a bridge between the browser's user interface and the rendering engine(described below). When a user interacts with the browser, the browser engine communicates with the rendering engine to act on the actions.

**3. Rendering Engine**

The main responsibility of the rendering engine is to render web page on the browser screen. It does this by interpreting XML, HTML and images to generate a layout that is then displayed in the browser content section. There are different rendering engines available for use by browsers. Examples include Webkit(used by Chrome, Safari), Gecko(used by Mozilla Firefox) etc.

**4. Networking**

This component handles communication to the server. This communication is achieved via internet protocols such as HyperText Transfer Protocol(HTTP) - protocol defines how messages are formatted and transmitted, and what actions Web servers and browsers should take in response to various commands or File Transfer Protocol(FTP) - a protocol used for the transfer of computer files between a client and server on a computer network.

**5. Javascript Interpreter**

Webpages can embed Javascript code to implement interactivity and other features that cannot be achieved with HTML and CSS. The Javascript interpreter's main role is to parse and execute Javascript code in the webpage. The script can be inline or external. For external scripts, the file is first fetched from the network. The results of the execution are passed to the Rendering engine for display.

**6. Data Persistence**

Browsers usually create a database in the local drive where its installed. This is used as a persistence layer. This persistence layer is exposed in different flavours for various purposes, this includes: localStorage, IndexedDB, WebSQl and FileSystem.

**7. UI Backend**

The main role of the UI backend is to display common UI components and drawing basic widgets like windows and combo boxes.

![Diagram of browser main components architecture](/writing/browser-architecture.png)

### Basic Flow of Rendering Engine

The rendering engine goes through the following steps to display the contents fetched over the network to the screen:

**Parsing HTML to construct the Document Object Model(DOM) Tree:**

The networking component passes the chunks of HTML to the rendering engine. The rendering engine parses the HTML document and converts elements to DOM tree. Parsing of HTML is done with an HTML parser whose output is a tree of DOM element and attribute nodes. The DOM has an almost one-to-one relation to the markup. Additionally, the parser will fix developer mistakes such as missing closing tags and request additional resources such as images.

**Render Tree construction**:

In addition to the DOM tree, the browser also creates another tree, the render tree: a visual representation of the document. The render tree is in the order in which the elements will be displayed. This is to enable painting of the elements in the correct order. Building the render tree requires calculating the visual properties of each element, visual properties are derived from the element's style properties. The source of stylesheets include: browser default style sheets, developer stylesheets and user style sheets.

**Layout of the render tree**:

This refers to the process of size and position of the render tree elements. The layout proceeds left-to-right, top-to-bottom in the document. This is referred to as flow-based layout method. The coordinate system is relative to the top-left coordinates(0, 0).

**Paint the render tree**:

In this stage, the render tree is traversed from the root, invoking paint instructions for each element and displaying the result to the screen. The order of painting is in the order in which the elements are stacked.

<p><sub>Photo credits: Heading image by <a href="https://unsplash.com/@dadaben_" target="_blank" rel="noopener noreferrer">Benjamin Dada</a></sub></p>

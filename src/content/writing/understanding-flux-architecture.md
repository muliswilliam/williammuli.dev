---
title: understanding flux architecture
description: Unidirectional data flow, and why it makes application state easier to reason about.
date: 2019-07-01
heroImage: /writing/flux-hero.jpg
tags: [flux, architecture, state-management]
---

Flux is an architectural pattern for building data layer for Javascript applications. Flux focuses on creating an explicit and understandable data flows i.e unidirectional data flow which increases predictability of application code.

**Flux comparison to MVC**

MVC short for Model, View, Controller is a client-side architecture. In this architecture, a user interaction on View prompts the controller which in turn calls one or more Models. When data in the model changes, the views are notified with the new data and they can update themselves.

The major drawback for MVC comes about as the application becomes larger. As an application using MVC grows, new models, views and controllers are added.

The dependency graph becomes more complex. This means that a single interaction on a View, multiple paths of execution happen. Tracing a bug in such an application becomes harder over time and can slow down implementation of new features.

The MVC pattern is illustrated in the diagram below:

![MVC Architecture](/writing/mvc.png)

Flux on the other hand avoids this design and focuses on **single directional data flow.**

**Parts of a Flux Application**

**Dispatcher**

The role of the dispatcher is to centrally manage all the data flow in a flux application. Each store registers itself and provides a callback. When a new action is provided to the dispatcher, all stores in the application receive the action through the callback provided in the registry.

**Store**

Stores contain the application state for a particular domain at a given point in time. A store registers itself with the dispatcher and provides it with a callback. This callback receives the action as a parameter. Within the store's registered callback, a switch statement based on the action's type is used to interpret the action and to provide the proper hooks into the store's internal methods. This allows an action to result in an update to the state of the store, via the dispatcher. After the stores are updated, they broadcast an event declaring that their state has changed, so the views may query the new state and update themselves.

**Views**

Views in flux architecture are responsible for getting the data to the store and listening for events that are broadcast from the stores that the view depends on. Views have a nested hierarchy, the view at the top of the hierarchy is responsible for fetching data from the store and passing it down to its children, this view is called a **controller-view.**

When a view receives an event from the store, it requests data from the store and sets its own state and that of its descendants.

It is a common practice to pass the entire state of the store down the hierarchy of views as a single object, the descendants can then consume 'slice' of the store that they need. This allows descendants to remain functionally pure and can be written as 'dumb' components.

An application may have additional controller-views down the hierarchy. This is usually done to keep components simple and to keep sections of hierarchy related to a specific data domain.

**Actions**

Actions represent the intent to perform manipulation of data in the store in a flux application.

An action comprises of a **type** string and a payload of data. The type string enables the store to interpret the action correctly and perform the intended data manipulation.

For example if we need to update a product item in our application, we would create an action in the form of a `function: _updateProduct(productId, updatedProduct)` in the _ProductActions_. A method like the one above is referred to as **Action creator**.

The type for our example action might be naked something like <em>PRODUCT_UPDATE</em>

In a view, for instance when existing product form is submitted, the action would be invoked.

Actions are generally invoked in the views in response to user interaction.

The parts described above and their communication are presented in the diagram below

![Parts of a flux application](/writing/flux-architecture.png)

**Benefits of Flux Pattern**

_Separation of concerns_

The logic of data manipulation in the store is cleanly separated from the views. The views don't need to know how to manipulate state, all they are doing is displaying the data and responding to user interaction.

_Easier Debugging_

Flux focuses on creating an explicit and understandable data flows. When errors happen in application state, debugging them becomes easier because you just need to find the action that led to the erroneous state, checking the store for the corresponding action logic and fixing that.

_Code predictability_

In flux pattern, data flows in a single direction. Additionally, all the logic for updating state is contained in the store itself and no other parts of the application need to know how to update the state. It is hard to understand an application if every part of the application can mutate state. This is not the case in a flux application.

_Unit testing_

Unit testing application code becomes a lesser complicated affair. This becomes as simple as providing an initial state, calling an action and checking to see if the final state is the expected state. With flux, views become more functionally pure making unit testing them easier too.

_Single source of truth_

The store acts as a single source of truth about the application state at any point in time. Actions can be replayed (redo or undo) to go back to a point in time etc.

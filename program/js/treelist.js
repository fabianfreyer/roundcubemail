/**
 * Roundcube Treelist Widget
 *
 * This file is part of the Roundcube Webmail client
 *
 * @licstart  The following is the entire license notice for the
 * JavaScript code in this file.
 *
 * Copyright (c) 2013-2014, The Roundcube Dev Team
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend  The above is the entire license notice
 * for the JavaScript code in this file.
 *
 * @author Thomas Bruederli <roundcube@gmail.com>
 * @requires jquery.js, common.js
 */


/**
 * Roundcube Treelist widget class
 * @contructor
 */
function rcube_treelist_widget(node, p)
{
  // apply some defaults to p
  p = $.extend({
    id_prefix: '',
    autoexpand: 1000,
    selectable: false,
    scroll_delay: 500,
    scroll_step: 5,
    scroll_speed: 20,
    save_state: false,
    check_droptarget: function(node){ return !node.virtual }
  }, p || {});

  var container = $(node),
    data = p.data || [],
    indexbyid = {},
    selection = null,
    drag_active = false,
    search_active = false,
    last_search = '',
    box_coords = {},
    item_coords = [],
    autoexpand_timer,
    autoexpand_item,
    body_scroll_top = 0,
    list_scroll_top = 0,
    scroll_timer,
    searchfield,
    tree_state,
    list_id = (container.attr('id') || p.id_prefix || '0'),
    me = this;


  /////// export public members and methods

  this.container = container;
  this.expand = expand;
  this.collapse = collapse;
  this.select = select;
  this.render = render;
  this.reset = reset;
  this.drag_start = drag_start;
  this.drag_end = drag_end;
  this.intersects = intersects;
  this.update = update_node;
  this.insert = insert;
  this.remove = remove;
  this.get_item = get_item;
  this.get_node = get_node;
  this.get_selection = get_selection;

  /////// startup code (constructor)

  // abort if node not found
  if (!container.length)
    return;

  if (p.data)
    index_data({ children:data });
  // load data from DOM
  else
    update_data();

  // register click handlers on list
  container.on('click', 'div.treetoggle', function(e){
    toggle(dom2id($(this).parent()));
    e.stopPropagation();
  });

  container.on('click', 'li', function(e){
    var node = p.selectable ? indexbyid[dom2id($(this))] : null;
    if (node && !node.virtual) {
      select(node.id);
      e.stopPropagation();
    }
  });

  // activate search function
  if (p.searchbox) {
    searchfield = $(p.searchbox).on('keyup', function(e) {
      var key = rcube_event.get_keycode(e),
        mod = rcube_event.get_modifier(e);

      switch (key) {
        case 9:   // tab
          break;

        case 13:  // enter
          search(this.value, true);
          return rcube_event.cancel(e);

        case 27:  // escape
          reset_search();
          break;

        case 38:  // arrow up
        case 37:  // left
        case 39:  // right
        case 40:  // arrow down
          return;  // ignore arrow keys

        default:
          search(this.value, false);
          break;
      }
    }).attr('autocomplete', 'off');

    // find the reset button for this search field
    searchfield.parent().find('a.reset').click(function(e) {
      reset_search();
      return false;
    })
  }


  /////// private methods

  /**
   * Collaps a the node with the given ID
   */
  function collapse(id, recursive, set)
  {
    var node;

    if (node = indexbyid[id]) {
      node.collapsed = typeof set == 'undefined' || set;
      update_dom(node);

      if (recursive && node.children) {
        for (var i=0; i < node.children.length; i++) {
          collapse(node.children[i].id, recursive, set);
        }
      }

      me.triggerEvent(node.collapsed ? 'collapse' : 'expand', node);
      save_state(id, node.collapsed);
    }
  }

  /**
   * Expand a the node with the given ID
   */
  function expand(id, recursive)
  {
    collapse(id, recursive, false);
  }

  /**
   * Toggle collapsed state of a list node
   */
  function toggle(id, recursive)
  {
    var node;
    if (node = indexbyid[id]) {
      collapse(id, recursive, !node.collapsed);
    }
  }

  /**
   * Select a tree node by it's ID
   */
  function select(id)
  {
    if (selection) {
      id2dom(selection).removeClass('selected');
      selection = null;
    }

    var li = id2dom(id);
    if (li.length) {
      li.addClass('selected');
      selection = id;
      // TODO: expand all parent nodes if collapsed
      scroll_to_node(li);
    }

    me.triggerEvent('select', indexbyid[id]);
  }

  /**
   * Getter for the currently selected node ID
   */
  function get_selection()
  {
    return selection;
  }

  /**
   * Return the DOM element of the list item with the given ID
   */
  function get_node(id)
  {
    return indexbyid[id];
  }

  /**
   * Return the DOM element of the list item with the given ID
   */
  function get_item(id, real)
  {
    return id2dom(id, real).get(0);
  }

  /**
   * Insert the given node
   */
  function insert(node, parent_id, sort)
  {
    var li, parent_li,
      parent_node = parent_id ? indexbyid[parent_id] : null
      search_ = search_active;

    // ignore, already exists
    if (indexbyid[node.id]) {
      return;
    }

    // apply saved state
    state = get_state(node.id, node.collapsed);
    if (state !== undefined) {
      node.collapsed = state;
    }

    // insert as child of an existing node
    if (parent_node) {
      if (!parent_node.children)
        parent_node.children = [];

      search_active = false;
      parent_node.children.push(node);
      parent_li = id2dom(parent_id);

      // re-render the entire subtree
      if (parent_node.children.length == 1) {
        render_node(parent_node, parent_li.parent(), parent_li);
        li = id2dom(node.id);
      }
      else {
        // append new node to parent's child list
        li = render_node(node, parent_li.children('ul').first());
      }

      // list is in search mode
      if (search_) {
        search_active = search_;

        // add clone to current search results (top level)
        if (!li.is(':visible')) {
          $('<li>')
            .attr('id', li.attr('id') + '--xsR')
            .attr('class', li.attr('class'))
            .addClass('searchresult__')
            .append(li.children().first().clone(true, true))
            .appendTo(container);
        }
      }
    }
    // insert at top level
    else {
      data.push(node);
      li = render_node(node, container);
    }

    indexbyid[node.id] = node;

    if (sort) {
      resort_node(li, typeof sort == 'string' ? '[class~="' + sort + '"]' : '');
    }
  }

  /**
   * Update properties of an existing node
   */
  function update_node(id, updates, sort)
  {
    var li, node = indexbyid[id];

    if (node) {
      li = id2dom(id);

      if (updates.id || updates.html || updates.children || updates.classes) {
        $.extend(node, updates);
        render_node(node, li.parent(), li);
      }

      if (node.id != id) {
        delete indexbyid[id];
        indexbyid[node.id] = node;
      }

      if (sort) {
        resort_node(li, typeof sort == 'string' ? '[class~="' + sort + '"]' : '');
      }
    }
  }

  /**
   * Helper method to sort the list of the given item
   */
  function resort_node(li, filter)
  {
    var first, sibling,
      myid = li.get(0).id,
      sortname = li.children().first().text().toUpperCase();

    li.parent().children('li' + filter).each(function(i, elem) {
      if (i == 0)
        first = elem;
      if (elem.id == myid) {
        // skip
      }
      else if (elem.id != myid && sortname >= $(elem).children().first().text().toUpperCase()) {
        sibling = elem;
      }
      else {
        return false;
      }
    });

    if (sibling) {
      li.insertAfter(sibling);
    }
    else if (first && first.id != myid) {
      li.insertBefore(first);
    }

    // reload data from dom
    update_data();
  }

  /**
   * Remove the item with the given ID
   */
  function remove(id)
  {
    var node, li;

    if (node = indexbyid[id]) {
      li = id2dom(id, true);
      li.remove();

      node.deleted = true;
      delete indexbyid[id];

      return true;
    }

    return false;
  }

  /**
   * (Re-)read tree data from DOM
   */
  function update_data()
  {
    data = walk_list(container);
  }

  /**
   * Apply the 'collapsed' status of the data node to the corresponding DOM element(s)
   */
  function update_dom(node)
  {
    var li = id2dom(node.id);
    li.children('ul').first()[(node.collapsed ? 'hide' : 'show')]();
    li.children('div.treetoggle').removeClass('collapsed expanded').addClass(node.collapsed ? 'collapsed' : 'expanded');
    me.triggerEvent('toggle', node);
  }

  /**
   *
   */
  function reset()
  {
    select('');

    data = [];
    indexbyid = {};
    drag_active = false;

    container.html('');

    reset_search();
  }

  /**
   * 
   */
  function search(q, enter)
  {
    q = String(q).toLowerCase();

    if (!q.length)
      return reset_search();
    else if (q == last_search && !enter)
      return 0;

    var hits = [];
    var search_tree = function(items) {
      $.each(items, function(i, node) {
        var li, sli;
        if (!node.virtual && !node.deleted && String(node.text).toLowerCase().indexOf(q) >= 0 && hits.indexOf(node.id) < 0) {
          li = id2dom(node.id);
          sli = $('<li>')
            .attr('id', li.attr('id') + '--xsR')
            .attr('class', li.attr('class'))
            .addClass('searchresult__')
            .append(li.children().first().clone(true, true))
            .appendTo(container);
            hits.push(node.id);
        }

        if (node.children && node.children.length) {
          search_tree(node.children);
        }
      });
    };

    // reset old search results
    if (search_active) {
      $(container).children('li.searchresult__').remove();
      search_active = false;
    }

    // hide all list items
    $(container).children('li').hide().removeClass('selected');

    // search recursively in tree (to keep sorting order)
    search_tree(data);
    search_active = true;
    last_search = q;

    me.triggerEvent('search', { query: q, last: last_search, count: hits.length, ids: hits, execute: enter||false });

    return hits.count;
  }

  /**
   * 
   */
  function reset_search()
  {
    if (searchfield)
      searchfield.val('');

    $(container).children('li.searchresult__').remove();
    $(container).children('li').show();

    search_active = false;

    me.triggerEvent('search', { query: false, last: last_search });
    last_search = '';

    if (selection)
      select(selection);
  }

  /**
   * Render the tree list from the internal data structure
   */
  function render()
  {
    if (me.triggerEvent('renderBefore', data) === false)
      return;

    // remove all child nodes
    container.html('');

    // render child nodes
    for (var i=0; i < data.length; i++) {
      render_node(data[i], container);
    }

    me.triggerEvent('renderAfter', container);
  }

  /**
   * Render a specific node into the DOM list
   */
  function render_node(node, parent, replace)
  {
    if (node.deleted)
      return;

    var li = $('<li>')
      .attr('id', p.id_prefix + (p.id_encode ? p.id_encode(node.id) : node.id))
      .addClass((node.classes || []).join(' '));

    if (replace)
      replace.replaceWith(li);
    else
      li.appendTo(parent);

    if (typeof node.html == 'string')
      li.html(node.html);
    else if (typeof node.html == 'object')
      li.append(node.html);

    if (!node.text)
      node.text = li.children().first().text();

    if (node.virtual)
      li.addClass('virtual');
    if (node.id == selection)
      li.addClass('selected');

    // add child list and toggle icon
    if (node.children && node.children.length) {
      $('<div class="treetoggle '+(node.collapsed ? 'collapsed' : 'expanded') + '">&nbsp;</div>').appendTo(li);
      var ul = $('<ul>').appendTo(li).attr('class', node.childlistclass);
      if (node.collapsed)
        ul.hide();

      for (var i=0; i < node.children.length; i++) {
        render_node(node.children[i], ul);
      }
    }

    return li;
  }

  /**
   * Recursively walk the DOM tree and build an internal data structure
   * representing the skeleton of this tree list.
   */
  function walk_list(ul)
  {
    var result = [];
    ul.children('li').each(function(i,e){
      var state, li = $(e), sublist = li.children('ul');
      var node = {
        id: dom2id(li),
        classes: String(li.attr('class')).split(' '),
        virtual: li.hasClass('virtual'),
        html: li.children().first().get(0).outerHTML,
        text: li.children().first().text(),
        children: walk_list(sublist)
      }

      if (sublist.length) {
        node.childlistclass = sublist.attr('class');
      }
      if (node.children.length) {
        node.collapsed = sublist.css('display') == 'none';

        // apply saved state
        state = get_state(node.id, node.collapsed);
        if (state !== undefined) {
          node.collapsed = state;
          sublist[(state?'hide':'show')]();
        }

        if (!li.children('div.treetoggle').length)
          $('<div class="treetoggle '+(node.collapsed ? 'collapsed' : 'expanded') + '">&nbsp;</div>').appendTo(li);
      }
      if (li.hasClass('selected')) {
        selection = node.id;
      }

      result.push(node);
      indexbyid[node.id] = node;
    })

    return result;
  }

  /**
   * Recursively walk the data tree and index nodes by their ID
   */
  function index_data(node)
  {
    if (node.id) {
      indexbyid[node.id] = node;
    }
    for (var c=0; node.children && c < node.children.length; c++) {
      index_data(node.children[c]);
    }
  }

  /**
   * Get the (stripped) node ID from the given DOM element
   */
  function dom2id(li)
  {
    var domid = li.attr('id').replace(new RegExp('^' + (p.id_prefix) || '%'), '').replace(/--xsR$/, '');
    return p.id_decode ? p.id_decode(domid) : domid;
  }

  /**
   * Get the <li> element for the given node ID
   */
  function id2dom(id, real)
  {
    var domid = p.id_encode ? p.id_encode(id) : id,
      suffix = search_active && !real ? '--xsR' : '';
    return $('#' + p.id_prefix + domid + suffix, container);
  }

  /**
   * Scroll the parent container to make the given list item visible
   */
  function scroll_to_node(li)
  {
    var scroller = container.parent(),
      current_offset = scroller.scrollTop(),
      rel_offset = li.offset().top - scroller.offset().top;

    if (rel_offset < 0 || rel_offset + li.height() > scroller.height())
      scroller.scrollTop(rel_offset + current_offset);
  }

  /**
   * Save node collapse state to localStorage
   */
  function save_state(id, collapsed)
  {
    if (p.save_state && window.rcmail) {
      var key = 'treelist-' + list_id;
      if (!tree_state) {
        tree_state = rcmail.local_storage_get_item(key, {});
      }

      if (tree_state[id] != collapsed) {
        tree_state[id] = collapsed;
        rcmail.local_storage_set_item(key, tree_state);
      }
    }
  }

  /**
   * Read node collapse state from localStorage
   */
  function get_state(id)
  {
    if (p.save_state && window.rcmail) {
      if (!tree_state) {
        tree_state = rcmail.local_storage_get_item('treelist-' + list_id, {});
      }
      return tree_state[id];
    }

    return undefined;
  }


  ///// drag & drop support

  /**
   * When dragging starts, compute absolute bounding boxes of the list and it's items
   * for faster comparisons while mouse is moving
   */
  function drag_start()
  {
    var li, item, height,
      pos = container.offset();

    body_scroll_top = bw.ie ? 0 : window.pageYOffset;
    list_scroll_top = container.parent().scrollTop();
    pos.top += list_scroll_top;

    drag_active = true;
    box_coords = {
      x1: pos.left,
      y1: pos.top,
      x2: pos.left + container.width(),
      y2: pos.top + container.height()
    };

    item_coords = [];
    for (var id in indexbyid) {
      li = id2dom(id);
      item = li.children().first().get(0);
      if (height = item.offsetHeight) {
        pos = $(item).offset();
        pos.top += list_scroll_top;
        item_coords[id] = {
          x1: pos.left,
          y1: pos.top,
          x2: pos.left + item.offsetWidth,
          y2: pos.top + height,
          on: id == autoexpand_item
        };
      }
    }

    // enable auto-scrolling of list container
    if (container.height() > container.parent().height()) {
      container.parent()
        .mousemove(function(e) {
          var scroll = 0,
            mouse = rcube_event.get_mouse_pos(e);
          mouse.y -= container.parent().offset().top;

          if (mouse.y < 25 && list_scroll_top > 0) {
            scroll = -1; // up
          }
          else if (mouse.y > container.parent().height() - 25) {
            scroll = 1; // down
          }

          if (drag_active && scroll != 0) {
            if (!scroll_timer)
              scroll_timer = window.setTimeout(function(){ drag_scroll(scroll); }, p.scroll_delay);
          }
          else if (scroll_timer) {
            window.clearTimeout(scroll_timer);
            scroll_timer = null;
          }
        })
        .mouseleave(function() {
          if (scroll_timer) {
            window.clearTimeout(scroll_timer);
            scroll_timer = null;
          }
        });
    }
  }

  /**
   * Signal that dragging has stopped
   */
  function drag_end()
  {
    drag_active = false;
    scroll_timer = null;

    if (autoexpand_timer) {
      clearTimeout(autoexpand_timer);
      autoexpand_timer = null;
      autoexpand_item = null;
    }

    $('li.droptarget', container).removeClass('droptarget');
  }

  /**
   * Scroll list container in the given direction
   */
  function drag_scroll(dir)
  {
    if (!drag_active)
      return;

    var old_top = list_scroll_top;
    container.parent().get(0).scrollTop += p.scroll_step * dir;
    list_scroll_top = container.parent().scrollTop();
    scroll_timer = null;

    if (list_scroll_top != old_top)
      scroll_timer = window.setTimeout(function(){ drag_scroll(dir); }, p.scroll_speed);
  }

  /**
   * Determine if the given mouse coords intersect the list and one if its items
   */
  function intersects(mouse, highlight)
  {
    // offsets to compensate for scrolling while dragging a message
    var boffset = bw.ie ? -document.documentElement.scrollTop : body_scroll_top,
      moffset = container.parent().scrollTop(),
      result = null;

    mouse.top = mouse.y + moffset - boffset;

    // no intersection with list bounding box
    if (mouse.x < box_coords.x1 || mouse.x >= box_coords.x2 || mouse.top < box_coords.y1 || mouse.top >= box_coords.y2) {
      // TODO: optimize performance for this operation
      $('li.droptarget', container).removeClass('droptarget');
      return result;
    }

    // check intersection with visible list items
    var pos, node;
    for (var id in item_coords) {
      pos = item_coords[id];
      if (mouse.x >= pos.x1 && mouse.x < pos.x2 && mouse.top >= pos.y1 && mouse.top < pos.y2) {
        node = indexbyid[id];

        // if the folder is collapsed, expand it after the configured time
        if (node.children && node.children.length && node.collapsed && p.autoexpand && autoexpand_item != id) {
          if (autoexpand_timer)
            clearTimeout(autoexpand_timer);

          autoexpand_item = id;
          autoexpand_timer = setTimeout(function() {
            expand(autoexpand_item);
            drag_start();  // re-calculate item coords
            autoexpand_item = null;
          }, p.autoexpand);
        }
        else if (autoexpand_timer && autoexpand_item != id) {
          clearTimeout(autoexpand_timer);
          autoexpand_item = null;
          autoexpand_timer = null;
        }

        // check if this item is accepted as drop target
        if (p.check_droptarget(node)) {
          if (highlight) {
            id2dom(id).addClass('droptarget');
            pos.on = true;
          }
          result = id;
        }
        else {
          result = null;
        }
      }
      else if (pos.on) {
        id2dom(id).removeClass('droptarget');
        pos.on = false;
      }
    }

    return result;
  }
}

// use event processing functions from Roundcube's rcube_event_engine
rcube_treelist_widget.prototype.addEventListener = rcube_event_engine.prototype.addEventListener;
rcube_treelist_widget.prototype.removeEventListener = rcube_event_engine.prototype.removeEventListener;
rcube_treelist_widget.prototype.triggerEvent = rcube_event_engine.prototype.triggerEvent;

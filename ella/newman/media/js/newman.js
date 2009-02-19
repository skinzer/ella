// Debugging tools
;;; function alert_dump(obj, name) {
;;;     var s = name ? name + ":\n" : '';
;;;     for (var i in obj) s += i + ': ' + obj[i] + "\n";
;;;     alert(s);
;;; }
function carp(message) {
    if (window.console) {
        console.log(message);
    }
}

( function($) { $(document).ready( function() {

    // We need to remember what URL is loaded in which element,
    // so we can load or not load content appropriately on hash change.
    var LOADED_URLS = {};

    // If the hash changes before all ajax requests complete,
    // we want to cancel the pending requests. MAX_REQUEST is actually the number
    // of the last hashchange event. Each ajax request then remembers the state
    // of this variable when it was issued and if it's obsolete by the time it's
    // finished, the results are discarded. It's OK to discard it because it
    // never gets into LOADED_URLS.
    var MAX_REQUEST = 0;

    // When a sequence of URLs to load into various elements is given,
    // the requests are stored in this fifo and their results are
    // rendered into the document as they become ready, but always in order.
    var LOAD_BUF = [];
    // These are the indices into the LOAD_BUF array -- MIN_LOAD is the index
    // of the request to be processed next (there should never be any defined
    // fields in LOAD_BUF at position less than MIN_LOAD).
    // MAX_LOAD should pretty much always be LOAD_BUF.length - 1.
    var MIN_LOAD, MAX_LOAD = -1;

    // When something is loaded into an element that has no base view (in urls.js),
    // and the user hits back, we need to reload. But then we don't want to reload again,
    // so keep information about whether we manipulated the content, so we can
    // abstain from reloading if we have not.
    var PAGE_CHANGED = 0;

    // Custom callbacks to be called before and after normally handling the hashchange pseudo event.
    var PRE_HASHCHANGE_CALLBACKS = [], POST_HASHCHANGE_CALLBACKS = [];
    window.add_hashchange_callback = function(fn, is_pre) {
        var queue = is_pre ? PRE_HASHCHANGE_CALLBACKS : POST_HASHCHANGE_CALLBACKS;
        var i = queue.length;
        queue[i] = fn;
        return i;
    }
    window.remove_hashchange_callback = function(id, is_pre) {
        var queue = is_pre ? PRE_HASHCHANGE_CALLBACKS : POST_HASHCHANGE_CALLBACKS;
        return delete queue[id];
    }

    function object_empty(o) {
        for (var k in o) return false;
        return true;
    }
    function keys(o) {
        var rv = [];
        for (var k in o) rv.push(k);
        return rv;
    }

    function inject_content($target, data, address) {
        // whatever was loaded inside, remove it from LOADED_URLS
        if (!object_empty(LOADED_URLS)) {
            var sel = '#'+keys(LOADED_URLS).join(',#');
            $target.find(sel).each(function() {
                delete LOADED_URLS[ this.id ];
            });
        }

        $target.removeClass('loading').html(data);
        dec_loading();
        if (address != undefined) {
            LOADED_URLS[ $target.attr('id') ] = address;
        }
        PAGE_CHANGED++;
    }

    // Check if the least present request has finished and if so, shift it
    // from the queue and render the results, and then call itself recursively.
    // This effectively renders all finished requests from the first up to the
    // first pending one, where it stops. If all requests are finished,
    // the queue gets cleaned and the indices reset.
    function draw_ready() {

        // Slide up to the first defined request or to the end of the queue
        while (!LOAD_BUF[ MIN_LOAD ] && LOAD_BUF.length > MIN_LOAD+1) MIN_LOAD++;

        // If the queue is empty, clean it
        if (!LOAD_BUF[ MIN_LOAD ]) {
//            ;;; carp("Emptying buffer");
            LOAD_BUF = [];
            MIN_LOAD = undefined;
            MAX_LOAD = -1;
            return;
        }
        var info = LOAD_BUF[ MIN_LOAD ];

        if (!info.data) return; // Not yet ready

        delete LOAD_BUF[ MIN_LOAD ];
        while (LOAD_BUF.length > MIN_LOAD+1 && !LOAD_BUF[ ++MIN_LOAD ]) {}
        var $target = $('#'+info.target_id);
        if ($target && $target.jquery && $target.length) {} else {
            carp('Could not find target element: #'+info.target_id);
            return;
        }

        inject_content($target, info.data, info.address);

        // Check next request
        draw_ready();
    }

    // This removes a request from the queue
    function cancel_request( load_id ) {
        var info = LOAD_BUF[ load_id ];
        delete LOAD_BUF[ load_id ];
        $('#'+info.target_id).removeClass('loading');
        dec_loading();

        // Restore the hash so it doesn't look like the request succeeded.
        url_target_id = ((info.target_id == 'content') ? '' : info.target_id+'::');
        adr(url_target_id + (LOADED_URLS[info.target_id] ? LOADED_URLS[info.target_id] : ''));

        carp('Failed to load '+info.address+' into '+info.target_id);
    }

    // Take a container and a URL. Give the container the "loading" class,
    // fetch the URL, push the request into the queue, and when it finishes,
    // check for requests ready to be loaded into the document.
    function load_content(arg) {
        var target_id = arg.target_id;
        var address = arg.address;
        ;;; carp('loading '+address+' into '+target_id);

        // An empty address means we should revert to the base state.
        // If one is not set up for the given container, reload the whole page.
        if (address.length == 0) {
            if (BASES[ target_id ]) {
                address = BASES[ target_id ];
            } else {
                if (PAGE_CHANGED) location.reload();
                return;
            }
        }

        $('#'+target_id).addClass('loading');
        show_loading();

        var url = $('<a>').attr('href', address).get(0).href;
        var load_id = ++MAX_LOAD;
        if (MIN_LOAD == undefined || load_id < MIN_LOAD) MIN_LOAD = load_id;
        LOAD_BUF[ load_id ] = {
            target_id: target_id,
            address: address
        };
        $.ajax({
            url: url,
            type: 'GET',
            success: function(data) {
                if (this.request_no < MAX_REQUEST) {
                    cancel_request( this.load_id );
                }
                else {
                    LOAD_BUF[ this.load_id ].data = data;
                }
                draw_ready();
            },
            error: function() {
                cancel_request( this.load_id );
                draw_ready();
            },
            load_id: load_id,
            request_no: MAX_REQUEST
        });
    }

    // We want location.hash to exactly describe what's on the page.
    // #url means that the result of $.get(url) be loaded into the #content div.
    // #id::url means that the result of $.get(url) be loaded into the #id element.
    // Any number of such specifiers can be concatenated, e.g. #/some/page/#header::/my/header/
    // If URLS[ foo ] is set (in urls.js), and #foo is present,
    // then the function is called given the $target as argument
    // and nothing else is done for this specifier.
    function load_by_hash() {
        var hash = location.hash.substr(1);
//        ;;; carp('load #'+MAX_REQUEST+'; hash: '+hash)

        // Figure out what should be reloaded and what not by comparing the requested things with the loaded ones.
        var requested = {};
        var specifiers = hash.split('#');
        var ids_map = {};
        var ids_arr = [];
        for (var i = 0; i < specifiers.length; i++) {
            var spec = specifiers[ i ];
            var address = spec;
            var target_id = 'content';
            if (spec.match(/^([-\w]+)::(.*)/)) {
                target_id  = RegExp.$1;
                address = RegExp.$2;
            }
            requested[ target_id ] = address;
            ids_map[ target_id ] = 1;
            ids_arr.push(target_id);
        }
        for (var k in LOADED_URLS)  if (!ids_map[ k ]) {
            ids_map[ k ] = 1;
            ids_arr.push(k);
        }
        var is_ancestor = {};
        for (var ai = 0; ai < ids_arr.length; ai++) {
            for (var di = 0; di < ids_arr.length; di++) {
                if (ai == di) continue;
                var aid = ids_arr[ai];
                var did = ids_arr[di];
                var $d = $('#'+did);
                if ($d && $d.length) {} else continue;
                var $anc = $d.parent().closest('#'+aid);
                if ($anc && $anc.length) {
                    is_ancestor[ aid+','+did ] = 1;
                }
            }
        }
        var processed = {};
        var reload_target = {};
        while (!object_empty(ids_map)) {

            // draw an element that's independent on any other in the list
            var ids = [];
            for (var id in ids_map) ids.push(id);
            var indep;
            for (var i = 0; i < ids.length; i++) {
                var top_el_id = ids[i];
                var is_independent = true;
                for (var j = 0; j < ids.length; j++) {
                    var low_el_id = ids[j];
                    if (low_el_id == top_el_id) continue;
                    if (is_ancestor[ low_el_id + ',' + top_el_id ]) {
                        is_independent = false;
                        break;
                    }
                }
                if (is_independent) {
                    indep = top_el_id;
                    delete ids_map[ top_el_id ];
                    break;
                }
            }
            if (!indep) {
                carp(ids_map);
                throw('Cyclic graph of elements???');
            }

            var result = {};
            for (var par in processed) {
                // if we went over an ancestor of this element
                if (is_ancestor[ par+','+indep ]) {
                    // and we marked it for reload
                    if (processed[ par ].to_reload) {
                        // and we're not just recovering
                        if (requested[ indep ]) {
                            // then reload no matter if url changed or not
                            result.to_reload = true;
                            break;
                        }
                        else {
                            // no need to recover when parent gets reloaded
                            result.to_reload = false;
                            break;
                        }
                    }
                }
            }

            // If parent didn't force reload or delete,
            if (result.to_reload == undefined) {
                // and the thing is no longer requested and we don't have the base loaded,
                if (!requested[ indep ] && LOADED_URLS[ indep ] != '') {
                    // then reload the base
                    result.to_reload = 1;
                }
            }

            if (result.to_reload == undefined) {
                // If the requested url changed,
                if (requested[ indep ] != LOADED_URLS[ indep ]) {
                    // mark for reload
                    result.to_reload = 1;
                }
            }

            // If we want to reload but no URL is set, default to the base
            if (result.to_reload && !requested[ indep ]) {
                requested[ indep ] = '';
            }

            processed[ indep ] = result;
        }
        // Now we figured out what to reload.

        for (var target_id in requested) {
            if (!processed[ target_id ].to_reload) {
                continue;
            }
            var address = requested[ target_id ];

            // A specially treated specifier. The callback should set up LOADED_URLS properly.
            // FIXME: Rewrite
            if (URLS[address]) {
                URLS[address](target_id);
                continue;
            }

            load_content({
                target_id: target_id,
                address: address
            });
        }
    }

    // Simulate a hashchange event fired when location.hash changes
    var CURRENT_HASH = '';
    function hashchange() {
//        carp('hash: ' + location.hash);
        MAX_REQUEST++;
        $('.loading').removeClass('loading');
        hide_loading();
        load_by_hash();
    }
    setTimeout( function() {
        var q;  // queue of user-defined callbacks
        try {
            if (location.hash != CURRENT_HASH) {
                CURRENT_HASH = location.hash;
                q =  PRE_HASHCHANGE_CALLBACKS; for (var i = 0; i < q.length; i++) if (typeof q[i] == 'function') q[i]();
                hashchange();
                q = POST_HASHCHANGE_CALLBACKS; for (var i = 0; i < q.length; i++) if (typeof q[i] == 'function') q[i]();
            }
        } catch(e) { carp(e); }
        setTimeout(arguments.callee, 50);
    }, 50);
    // End of hash-driven content management

    // Loads stuff from an URL to an element like load_by_hash but:
    // - Only one specifier (id-url pair) can be given.
    // - URL hash doesn't change.
    // - The specifier is interpreted by adr to get the URL from which to ajax.
    //   This results in support of relative addresses and the target_id::rel_base::address syntax.
    function simple_load(specifier) {
        var target_id, address;
        var colon_index = specifier.indexOf('::');
        if (colon_index < 0) {
            target_id = 'content';
            address = specifier;
        }
        else {
            target_id = specifier.substr(0, colon_index);
            address = specifier.substr(colon_index + '::'.length);
        }
        colon_index = address.indexOf('::');
        if (colon_index >= 0) {
            address = address.substr(colon_index + '::'.length);
        }

        if (LOADED_URLS[target_id] == address) return;

        var url = adr(specifier, {just_get:1});
        var url = $('<a>').attr('href', url).get(0).href;

        var $target = $('#'+target_id);
        if ($target && $target.length) {} else {
            throw("Target '#"+target_id+"' not found.");
            return;
        }
        $target.addClass('loading');
        show_loading();
        $.get(url, function(data) {
            inject_content($target, data, address);
        });
    }

    // Set up event handlers
    $('.simpleload,.simpleload-container a').live('click', function() {
        simple_load($(this).attr('href'));
        return false;
    });
    $('.hashadr,.hashadr-container a').live('click', function() {
        adr($(this).attr('href'));
        return false;
    });
})})(jQuery);

// Manipulate the hash address.
//
// We use http://admin/#/foo/ instead of http://admin/foo/.
// Therefore, <a href="bar/"> won't lead to http://admin/#/foo/bar/ as we need but to http://admin/bar/.
// To compensate for this, use <a href="javascript:adr('bar/')> instead.
// adr('id::bar/') can be used too.
//
// adr('bar/#id::baz/') is the same as adr('bar/'); adr('id::baz/').
// Absolute paths and ?var=val strings work too.
//
// Alternatively, you can use <a href="bar/" class="hashadr">.
// The hashadr class says clicks should be captured and delegated to function adr.
// A third way is to encapsulate a link (<a>) into a .hashadr-container element.
//
// The target_id::rel_base::address syntax in a specifier means that address is taken as relative
// to the one loaded to rel_base and the result is loaded into target_id.
// For example, suppose that location.hash == '#id1::/foo/'. Then calling
// adr('id2::id1::bar/') would be like doing location.hash = '#id1::/foo/#id2::/foo/bar/'.
//
// The second argument is an object where these fields are recognized:
// - hash: a custom hash string to be used instead of location.hash,
// - just_get: Instructs the function to merely return the modified address (without the target_id).
//   Using this option disables the support of multiple '#'-separated specifiers.
//   Other than the first one are ignored.
function adr(address, options) {

    // '#' chars in the address separate invividual requests for hash modification.
    // First deal with the first one and then recurse on the subsequent ones.
    if (address.charAt(0) == '#') address = address.substr(1);
    var hashpos = (address+'#').indexOf('#');
    var tail = address.substr(hashpos+1);
    address = address.substr(0, hashpos);

    if (!options) options = {};
    var hash = (options.hash == undefined) ? location.hash : options.hash;

    // Figure out which specifier is concerned.
    var target_id = '';
    // But wait, if target_id::rel_base::address was specified,
    // then get the modifier address and insert it then as appropriate.
    var new_address;
    if (address.match(/([-\w]*)::([-\w]*)::(.*)/)) {
        var rel_base;
        target_id = RegExp.$1;
        rel_base  = RegExp.$2;
        address   = RegExp.$3;
        if (rel_base.length) rel_base  += '::';
        new_address = adr(rel_base+address, {hash:hash, just_get:1})
        if (options.just_get) return new_address;
    }
    // OK, go on figuring out which specifier is concerned.
    else if (address.match(/([-\w]*)::(.*)/)) {
        target_id = RegExp.$1;
        address   = RegExp.$2;
    }

    // If no hash is present, simply use the address.
    if (hash.length <= 1) {
        var newhash;
        if (target_id.length == 0) {
            newhash = address;
        }
        else {
            newhash = target_id + '::' + address
        }
        if (options.just_get) return newhash;
        else {
            location.hash = newhash;
            return;
        }
    }

    // Figure out the span in the current hash where the change applies.
    var start = 0;
    var end;
    var specifier_prefix = '';
    if (target_id.length == 0) {
        for (; start >= 0; start = hash.indexOf('#', start+1)) {
            end = (hash+'#').indexOf('#', start+1);
            if (hash.substring(start, end).indexOf('::') < 0) {
                start++;
                break;
            }
        }
        if (start < 0) {
            hash += '#';
            start = end = hash.length;
        }
    }
    else {
        var idpos = hash.indexOf(target_id+'::');
        if (idpos == -1) {
            hash += '#';
            start = end = hash.length;
            specifier_prefix = target_id + '::';
        }
        else {
            start = idpos + target_id.length + '::'.length;
            end = (hash+'#').indexOf('#', start);
        }
    }
    // Now, hash.substr(start,end) is the address we need to modify.

    // Figure out whether we replace the address, append to it, or what.
    // Move start appropriately to denote where the part to replace starts.

    var newhash;
    var addr_start = start;

    // We've not gotten the address from a previous recursive call, thus modify the address as needed.
    if (new_address == undefined) {
        new_address = address;

        // empty address -- remove the specifier
        if (address.length == 0) {
            start = hash.lastIndexOf('#',start);
            start = Math.max(start,0);
        }
        // absolute address -- replace what's in there.
        else if (address.charAt(0) == '/') {
        }
        // relative address -- append to the end, but no farther than to a '?'
        else {
            var left_anchor = hash.lastIndexOf('#', start)+1;
            start = (hash.substr(0, end)+'?').indexOf('?', start);

            // cut off the directories as appropriate when the address starts with ../
            while (new_address.substr(0,3) == '../' && hash.substring(left_anchor,start-1).indexOf('/') >= 0) {
                new_address = new_address.substr(3);
                start = hash.lastIndexOf('/', start-2)+1;
            }
        }
    }

    newhash = hash.substr(0, start) + specifier_prefix + new_address + hash.substr(end);

    if (options.just_get) {
        return hash.substring(addr_start, start) + new_address;
    }
    else if (tail) {
        adr(tail, {hash:newhash});
    }
    else {
        location.hash = newhash;
    }
}


/////// END OF THE LIBRARY
///////
/////// BEGIN CODE FOR SPECIFIC USE


$( function() {
    // Submit buttons for ajax forms
    $('.submit-row input[name=action] ~ a.icn.btn.ok.def').live('click', function() {
        var $submit_row = $(this).closest('.submit-row');
        var  action  =  $submit_row.find('input[name=action]').val();
        var  method  = ($submit_row.find('input[name=method]').val() || 'POST').toUpperCase();
        var $success =  $submit_row.find('input[name=success]');
        var $error   =  $submit_row.find('input[name=error]');
        var success, error;
        if ($success && $success.length) {
            success = function(data) { $success.get(0).onchange(data); };
        } else {
            success = function(data) { show_message(data); };
        }
        if ($error && $error.length) {
            error = function(xhr, st) { $error.get(0).onchange(xhr, st); };
        }
        else {
            error = function(xhr) { show_message(xhr.responseText, {msgclass: 'errmsg'}); };
        }
        var  data = {};
        $submit_row.parent().find(':input').each( function() {
            if ($(this).parent().is('.submit-row')) return;
            if (!this.name) return;
            data[ this.name ] = $(this).val();
        });
        $.ajax({
            url: action,
            type: method,
            data: data,
            success: success,
            error:   error
        });
    });

    // Packing and unpacking filter list. To be removed when filters are reimplemented.
    $('#filters :header').live('click', function() {
        $(this).next(':first').filter('ul').slideToggle('slow');
    });
});

function show_message(message, options) {
    if (!options) options = {};
    var duration = (options.duration == undefined) ? 5000 : options.duration;
    var $span = $('<span></span>').html(message);
    var $msg = $('<br />').add($span);
    if (options.msgclass) $span.addClass(options.msgclass);
    $('#opmsg').append($msg);
    if (duration) setTimeout(function() {
        $span.fadeOut('slow', function(){ $msg.remove(); });
    }, duration);
    return $msg;
}


// The 'loading...' message
//                How many things need the loading message shown concurrently
var $LOADING_MSG, LOADING_CNT = 0;
function show_loading() {
    LOADING_CNT++;
    if ($LOADING_MSG) return;
    $LOADING_MSG = show_message('loading...', {duration:0});
}
function hide_loading() {
    if ($LOADING_MSG) $LOADING_MSG.remove();
    LOADING_CNT = 0;
    $LOADING_MSG = undefined;
}
function dec_loading() {
    if (--LOADING_CNT <= 0) {
        LOADING_CNT = 0;
        hide_loading();
    }
}
import _ from 'underscore';
import $ from 'jquery';
import is from 'is_js';
import baseVw from '../baseVw';
import loadTemplate from '../../utils/loadTemplate';
import app from '../../app';
import { openSimpleMessage } from '../modals/SimpleMessage';
import Dialog from '../modals/Dialog';
import Results from './Results';
import ResultsCol from '../../collections/Results';
import Providers from './SearchProviders';
import ProviderMd from '../../models/search/SearchProvider';
import { selectEmojis } from '../../utils';
import { getCurrentConnection } from '../../utils/serverConnect';

export default class extends baseVw {
  constructor(options = {}) {
    super(options);
    this.options = options;

    this.searchProviders = this.createChild(Providers, { usingTor: this.usingTor });
    this.listenTo(this.searchProviders, 'activateProvider', opts => this.activateProvider(opts));

    this.sProvider = app.searchProviders.defaultProvider;
    this.searchUrl = app.serverConfig.tor && getCurrentConnection().server.get('useTor') ?
      this.sProvider.get('listingsUrl') : this.sProvider.get('torListingsUrl');

    // the search provider is used here as a placeholder to get the parameters from the created url
    const searchUrl = new URL(`${this.searchUrl}?${options.query || ''}`);
    let queryParams = searchUrl.searchParams;

    // if a url with parameters was in the query in, use the parameters in it instead.
    if (queryParams.get('providerQ')) {
      const subURL = new URL(queryParams.get('providerQ'));
      queryParams = subURL.searchParams;
      this.searchUrl = `${subURL.origin}${subURL.pathname}`;
    }

    const params = {};

    for (const param of queryParams.entries()) {
      params[param[0]] = param[1];
    }

    // use the parameters from the query unless they were overridden in the options
    this.serverPage = options.serverPage || params.p || 0;
    this.pageSize = options.pageSize || params.ps || 12;
    this.term = options.term || params.q || '';
    this.sortBySelected = options.sortBySelected || params.sortBy || '';
    // all parameters not specified above are assumed to be filters
    this.filters = _.omit(params, ['q', 'p', 'ps', 'sortBy', 'providerQ']);

    this.processTerm(this.term);

    // TODO: remove this, and the ability to set the default in the settings
    // if not using a passed in URL, update the default provider if it changes
    this.listenTo(app.localSettings, 'change:searchProvider', (model, provider) => {
      if (this.usingDefault) {
        this.sProvider = provider;
        this.processTerm(this.term);
      }
    });
  }

  className() {
    return 'search';
  }

  events() {
    return {
      'click .js-searchBtn': 'clickSearchBtn',
      'change .js-sortBy': 'changeSortBy',
      'change .js-filterWrapper select': 'changeFilter',
      'change .js-filterWrapper input': 'changeFilter',
      'keyup .js-searchInput': 'onKeyupSearchInput',
      'click .js-deleteProvider': 'clickDeleteProvider',
    };
  }

  get usingDefault() {
    return this.sProvider === app.localSettings.get('searchProvider');
  }

  get usingTor() {
    return app.serverConfig.tor && getCurrentConnection().server.get('useTor');
  }

  activateProvider(md) {
    if (!md || !(md instanceof ProviderMd)) {
      throw new Error('Please provide a search provider model.');
    }
    this.sProvider = md;
    this.searchUrl = this.usingTor ? md.get('torListingsUrl') : md.get('listingsUrl');
    this.processTerm(this.term);
  }

  clickDeleteProvider() {
    this.deleteProvider();
  }

  deleteProvider(md = this.sProvider) {
    if (md.get('locked')) {
      openSimpleMessage(app.polyglot.t('search.errors.locked'));
    } else {
      md.destroy();
      if (app.searchProviders.length) this.activateProvider(app.searchProviders.at(0));
    }
  }

  /**
   * This will create a url with the term and other query parameters
   * @param {string} term
   */
  processTerm(term) {
    this.term = term || '';
    // if term is false, search for *
    const query = `q=${encodeURIComponent(term || '*')}`;
    const page = `&p=${this.serverPage}&ps=${this.pageSize}`;
    const sortBy = this.sortBySelected ? `&sortBy=${encodeURIComponent(this.sortBySelected)}` : '';
    let filters = $.param(this.filters);
    filters = filters ? `&${filters}` : '';
    const newURL = `${this.searchUrl}?${query}${sortBy}${page}${filters}`;
    this.callSearchProvider(newURL);
  }

  callSearchProvider(searchUrl) {
    // remove a pending search if it exists
    if (this.callSearch) this.callSearch.abort();

    // initial render to show the loading spinner
    this.render();

    // query the search provider
    this.callSearch = $.get({
      url: searchUrl,
      dataType: 'json',
    })
        .done((data, status, xhr) => {
        // make sure minimal data is present
          if (data.name && data.links) {
            // if data about the provider is recieved, update the model
            this.sProvider.set('name', data.name);
            if (data.logo && is.url(data.logo)) this.sProvider.set('logoUrl', data.logo);
            if (data.links) {
              if (data.links.search && is.url(data.links.search)) {
                this.sProvider.set('allUrl', data.links.search);
              }
              if (data.links.tor && data.links.tor.search && is.url(data.links.tor.search)) {
                this.sProvider.set('allTorUrl', data.links.tor.search);
              }
              if (data.links.listings && is.url(data.links.listings)) {
                this.sProvider.set('listingsUrl', data.links.listings);
              }
              if (data.links.tor && data.links.tor.listings && is.url(data.links.tor.listings)) {
                this.sProvider.set('torListingsUrl');
              }
            }
            this.render(data, searchUrl);
          } else {
            this.render({}, searchUrl, xhr);
          }
        })
        .fail((xhr) => {
          if (xhr.statusText !== 'abort') {
            this.render({}, searchUrl, xhr);
          }
        });
  }

  showSearchError(xhr = {}) {
    const title = app.polyglot.t('search.errors.searchFailTitle', { provider: this.sProvider });
    const failReason = xhr.responseJSON ? xhr.responseJSON.reason : '';
    const msg = failReason ?
                app.polyglot.t('search.errors.searchFailReason', { error: failReason }) : '';
    const buttons = [];
    if (this.usingDefault) {
      buttons.push({
        text: app.polyglot.t('search.changeProvider'),
        fragment: 'changeProvider',
      });
    } else {
      buttons.push({
        text: app.polyglot.t('search.useDefault',
          { term: this.term, defaultProvider: app.localSettings.get('searchProvider') }),
        fragment: 'useDefault',
      });
    }

    const errorDialog = new Dialog({
      title,
      msg,
      buttons,
      showCloseButton: false,
      removeOnClose: true,
    }).render().open();
    this.listenTo(errorDialog, 'click-changeProvider', () => {
      errorDialog.close();
    });
    this.listenTo(errorDialog, 'click-useDefault', () => {
      this.activateProvider(app.searchProviders.defaultProvider);
      errorDialog.close();
    });
  }

  createResults(data, searchUrl) {
    this.resultsCol = new ResultsCol();
    this.resultsCol.add(this.resultsCol.parse(data));

    const resultsView = this.createChild(Results, {
      searchUrl,
      total: data.results ? data.results.total : 0,
      morePages: data.results ? data.results.morePages : false,
      serverPage: this.serverPage,
      pageSize: this.pageSize,
      initCol: this.resultsCol,
    });

    this.$resultsWrapper.html(resultsView.render().el);

    this.listenTo(resultsView, 'searchError', (xhr) => this.showSearchError(xhr));
    this.listenTo(resultsView, 'loadingPage', () => this.scrollToTop());
  }

  clickSearchBtn() {
    this.processTerm(this.$searchInput.val());
  }

  onKeyupSearchInput(e) {
    if (e.which === 13) {
      this.processTerm(this.$searchInput.val());
    }
  }

  changeSortBy(e) {
    this.sortBySelected = $(e.target).val();
    this.processTerm(this.term);
  }

  changeFilter(e) {
    const targ = $(e.target);
    this.filters[targ.prop('name')] = targ.val();
    this.processTerm(this.term);
  }

  scrollToTop() {
    this.$el[0].scrollIntoView();
  }

  remove() {
    if (this.callSearch) this.callSearch.abort();
    super.remove();
  }

  render(data, searchUrl, xhr) {
    if (data && !searchUrl) {
      throw new Error('Please provide the search URL along with the data.');
    }

    let errTitle;
    let errMsg;

    if (xhr) {
      errTitle = app.polyglot.t('search.errors.searchFailTitle', { provider: searchUrl });
      const failReason = xhr.responseJSON ? xhr.responseJSON.reason : '';
      errMsg = failReason ?
        app.polyglot.t('search.errors.searchFailReason', { error: failReason }) : '';
    }

    // the first render has no data, and only shows the loading state
    const loading = !data;

    // check to see if the call to the provider failed, or returned an empty result
    const emptyData = $.isEmptyObject(data);

    loadTemplate('search/Search.html', (t) => {
      this.$el.html(t({
        term: this.term === '*' ? '' : this.term,
        sortBySelected: this.sortBySelected,
        filterVals: this.filters,
        errTitle,
        errMsg,
        emptyData,
        loading,
        ...data,
      }));
    });
    this.$sortBy = this.$('#sortBy');
    this.$sortBy.select2({
      // disables the search box
      minimumResultsForSearch: Infinity,
      templateResult: selectEmojis,
      templateSelection: selectEmojis,
    });
    const filterWrapper = this.$('.js-filterWrapper');
    filterWrapper.find('select').select2({
      // disables the search box
      minimumResultsForSearch: Infinity,
      templateResult: selectEmojis,
      templateSelection: selectEmojis,
    });
    this.$filters = filterWrapper.find('select, input');
    this.$resultsWrapper = this.$('.js-resultsWrapper');
    this.$searchInput = this.$('.js-searchInput');
    this.$searchLogo = this.$('.js-searchLogo');

    this.$searchLogo.find('img').on('error', () => {
      this.$searchLogo.addClass('loadError');
    });

    this.searchProviders.delegateEvents();
    this.$('.js-searchProviders').append(this.searchProviders.render().el);

    // use the initial set of results data to create the results view
    if (data) this.createResults(data, searchUrl);

    return this;
  }
}
